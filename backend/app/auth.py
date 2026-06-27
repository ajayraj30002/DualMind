from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from datetime import datetime, timedelta
import jwt
import bcrypt
import smtplib
import random
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .config import Config

security = HTTPBearer()

# Initialize Supabase client
supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)

# SMTP Configuration
SMTP_EMAIL = Config.SMTP_EMAIL
SMTP_APP_PASSWORD = Config.SMTP_APP_PASSWORD
SMTP_HOST = Config.SMTP_HOST
SMTP_PORT = Config.SMTP_PORT


def create_access_token(data: dict) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=Config.JWT_EXPIRY_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, Config.JWT_SECRET_KEY, algorithm=Config.JWT_ALGORITHM)
    return encoded_jwt


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Verify JWT token and return user data"""
    token = credentials.credentials
    
    try:
        payload = jwt.decode(
            token,
            Config.JWT_SECRET_KEY,
            algorithms=[Config.JWT_ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(payload: dict = Depends(verify_token)) -> dict:
    """Get current user from token payload"""
    user_id = payload.get("sub")
    email = payload.get("email")
    
    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload"
        )
    
    try:
        response = supabase.table("users").select("*").eq("id", user_id).execute()
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        user = response.data[0]
        # Treat missing column or null (None) as True for legacy users
        # Only explicitly False will trigger the 403
        if user.get("is_verified") is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Email not verified. Please verify your email first."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication error"
        )
    
    return {"user_id": user_id, "email": email}


# ========== OTP FUNCTIONS ==========

def generate_otp() -> str:
    """Generate a 6-digit OTP"""
    return f"{random.randint(100000, 999999)}"


def send_otp_email(to_email: str, otp: str, full_name: str = "") -> bool:
    """Send OTP email using SMTP"""
    try:
        if not SMTP_EMAIL or not SMTP_APP_PASSWORD:
            print("SMTP credentials not configured")
            return False
        
        subject = "DualMind - Email Verification OTP"
        body = f"""Hello {full_name or 'there'},

Your OTP for email verification is: {otp}

This OTP is valid for 5 minutes.

If you didn't request this, please ignore this email.

- DualMind Team"""
        
        msg = MIMEMultipart()
        msg['From'] = f"DualMind <{SMTP_EMAIL}>"
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.send_message(msg)
        
        return True
    except Exception as e:
        print(f"SMTP error: {e}")
        return False


def store_otp(email: str, otp: str, full_name: str = "", hashed_password: str = "") -> bool:
    """Store OTP in Supabase"""
    try:
        # Delete any existing OTP for this email
        supabase.table("otp_verifications").delete().eq("email", email).execute()
        
        expires_at = (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        supabase.table("otp_verifications").insert({
            "email": email,
            "otp": otp,
            "full_name": full_name,
            "hashed_password": hashed_password,
            "expires_at": expires_at
        }).execute()
        return True
    except Exception as e:
        print(f"Store OTP error: {e}")
        return False


def verify_otp(email: str, otp: str) -> bool:
    """Verify OTP from Supabase"""
    try:
        response = supabase.table("otp_verifications")\
            .select("*")\
            .eq("email", email)\
            .eq("otp", otp)\
            .execute()
        
        if not response.data:
            return False
        
        record = response.data[0]
        expires_at = datetime.fromisoformat(record["expires_at"])
        
        if datetime.utcnow() > expires_at:
            supabase.table("otp_verifications").delete().eq("email", email).execute()
            return False
        
        return True
    except Exception as e:
        print(f"Verify OTP error: {e}")
        return False


def get_otp_record(email: str) -> dict:
    """Get OTP record for email"""
    try:
        response = supabase.table("otp_verifications")\
            .select("*")\
            .eq("email", email)\
            .execute()
        return response.data[0] if response.data else None
    except Exception as e:
        print(f"Get OTP record error: {e}")
        return None


def create_user_from_otp(email: str) -> dict:
    """Create a verified user from OTP record"""
    try:
        # Get OTP record
        record = get_otp_record(email)
        if not record:
            return None
        
        # Create user
        response = supabase.table("users").insert({
            "email": email,
            "hashed_password": record["hashed_password"],
            "full_name": record["full_name"],
            "is_verified": True,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        if response.data:
            # Delete OTP record after successful user creation
            supabase.table("otp_verifications").delete().eq("email", email).execute()
            return response.data[0]
        
        return None
    except Exception as e:
        print(f"Create user from OTP error: {e}")
        return None


def delete_otp_record(email: str) -> bool:
    """Delete OTP record for email"""
    try:
        supabase.table("otp_verifications").delete().eq("email", email).execute()
        return True
    except Exception as e:
        print(f"Delete OTP error: {e}")
        return False
