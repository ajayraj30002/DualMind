/**
 * DualMind - Photorealistic 3D Glowing Orb Renderer
 * Represents DualMind's Dual Intelligence Core:
 * Grounded Document Neural Space (Deep Obsidian/Violet) + Live Web Synthesis (Radiant Amber/Orange)
 */
class GlowingOrb {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        this.width = 180;
        this.height = 180;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        
        this.canvas.width = this.width * this.pixelRatio;
        this.canvas.height = this.height * this.pixelRatio;
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.scale(this.pixelRatio, this.pixelRatio);
        
        this.radius = 48;
        this.centerX = this.width / 2;
        this.baseCenterY = this.height / 2 - 4;
        this.time = 0;
        this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
        this.isRunning = false;
        
        this.initEvents();
        this.start();
    }
    
    initEvents() {
        window.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            if (rect.width === 0) return;
            const x = (e.clientX - (rect.left + rect.width / 2)) / 300;
            const y = (e.clientY - (rect.top + rect.height / 2)) / 300;
            this.mouse.targetX = Math.max(-1, Math.min(1, x));
            this.mouse.targetY = Math.max(-1, Math.min(1, y));
        });
    }
    
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        const animate = () => {
            if (!this.isRunning) return;
            this.render();
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }
    
    stop() {
        this.isRunning = false;
    }
    
    render() {
        const ctx = this.ctx;
        if (!ctx) return;
        
        this.time += 0.024;
        
        // Damped smooth mouse tilt
        this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.06;
        this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.06;
        
        // Harmonic floating oscillation
        const floatOffset = Math.sin(this.time) * 5.5;
        const cy = this.baseCenterY + floatOffset + this.mouse.y * 5;
        const cx = this.centerX + this.mouse.x * 5;
        const r = this.radius;
        
        ctx.clearRect(0, 0, this.width, this.height);
        
        // 1. Dynamic Floor Shadow (Breathes as sphere rises and falls)
        const shadowScale = 1 - (floatOffset / 42);
        const shadowAlpha = 0.26 - (floatOffset / 65);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.centerX, this.baseCenterY + r + 22, r * 0.74 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
        const shadowGrad = ctx.createRadialGradient(
            this.centerX, this.baseCenterY + r + 22, 2,
            this.centerX, this.baseCenterY + r + 22, r * 0.74 * shadowScale
        );
        shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
        shadowGrad.addColorStop(0.45, `rgba(249, 115, 22, ${shadowAlpha * 0.35})`);
        shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = shadowGrad;
        ctx.fill();
        ctx.restore();
        
        // 2. DualMind Radiant Aura Halo (Amber core + Ultraviolet rim)
        const glowRadius = r * 1.65;
        const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, glowRadius);
        glowGrad.addColorStop(0, 'rgba(249, 115, 22, 0.45)');   // Energetic Amber
        glowGrad.addColorStop(0.4, 'rgba(234, 88, 12, 0.22)');
        glowGrad.addColorStop(0.75, 'rgba(168, 85, 247, 0.12)'); // Subtle Ultraviolet
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // 3. 3D Spherical Volume with Internal Scattering
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        
        // Light vector
        const lightX = cx - r * 0.32 + this.mouse.x * 6;
        const lightY = cy - r * 0.35 + this.mouse.y * 6;
        
        // Shaded sphere body
        const bodyGrad = ctx.createRadialGradient(lightX, lightY, 3, cx, cy, r * 1.05);
        bodyGrad.addColorStop(0, '#fff7ed');      // Radiant warm core
        bodyGrad.addColorStop(0.18, '#ffedd5');   // Light amber
        bodyGrad.addColorStop(0.42, '#f97316');   // DualMind Primary Orange
        bodyGrad.addColorStop(0.72, '#c2410c');   // Deep amber
        bodyGrad.addColorStop(0.92, '#581c87');   // Deep violet vector shadow
        bodyGrad.addColorStop(1, '#180226');
        
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        
        // 4. Caustic Rim Highlight (Reflecting global knowledge)
        const rimGrad = ctx.createRadialGradient(cx + r * 0.45, cy + r * 0.45, 2, cx, cy, r);
        rimGrad.addColorStop(0, 'rgba(251, 146, 60, 0.7)');   // Warm amber rim
        rimGrad.addColorStop(0.45, 'rgba(249, 115, 22, 0.28)');
        rimGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = rimGrad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        
        // 5. Specular Glare (Glossy Glass finish)
        const specX = lightX - 4;
        const specY = lightY - 4;
        const specGrad = ctx.createRadialGradient(specX, specY, 1, specX, specY, r * 0.36);
        specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
        specGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
        specGrad.addColorStop(0.7, 'rgba(254, 215, 170, 0.16)');
        specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = specGrad;
        ctx.beginPath();
        ctx.arc(specX, specY, r * 0.36, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Instantiate orb on DOM ready
window.addEventListener('DOMContentLoaded', () => {
    window.dualMindOrb = new GlowingOrb('heroOrbCanvas');
});
