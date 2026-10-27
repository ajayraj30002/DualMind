/**
 * DualMind - Photorealistic 3D Glowing Orb Renderer
 * Creates a glossy, iridescent 3D sphere with ambient bloom, specular reflection,
 * subsurface scattering (violet + amber/orange), and floating physics.
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
        
        // Smooth mouse damping
        this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.06;
        this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.06;
        
        // Floating physics
        const floatOffset = Math.sin(this.time) * 6;
        const cy = this.baseCenterY + floatOffset + this.mouse.y * 5;
        const cx = this.centerX + this.mouse.x * 5;
        const r = this.radius;
        
        ctx.clearRect(0, 0, this.width, this.height);
        
        // 1. Soft Floor Shadow (expands & contracts with float)
        const shadowScale = 1 - (floatOffset / 40);
        const shadowAlpha = 0.22 - (floatOffset / 70);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.centerX, this.baseCenterY + r + 22, r * 0.72 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
        const shadowGrad = ctx.createRadialGradient(
            this.centerX, this.baseCenterY + r + 22, 2,
            this.centerX, this.baseCenterY + r + 22, r * 0.72 * shadowScale
        );
        shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
        shadowGrad.addColorStop(0.5, `rgba(168, 85, 247, ${shadowAlpha * 0.3})`);
        shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = shadowGrad;
        ctx.fill();
        ctx.restore();
        
        // 2. Outer Ambient Glow Halo
        const glowRadius = r * 1.6;
        const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, glowRadius);
        glowGrad.addColorStop(0, 'rgba(168, 85, 247, 0.42)'); // Amethyst
        glowGrad.addColorStop(0.4, 'rgba(249, 115, 22, 0.24)'); // Sunset amber
        glowGrad.addColorStop(0.8, 'rgba(234, 88, 12, 0.08)');
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // 3. 3D Sphere Body with Subsurface Scattering
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        
        // Base dark-violet to deep-amber body gradient
        const lightX = cx - r * 0.32 + this.mouse.x * 6;
        const lightY = cy - r * 0.35 + this.mouse.y * 6;
        
        const bodyGrad = ctx.createRadialGradient(lightX, lightY, 4, cx, cy, r * 1.05);
        bodyGrad.addColorStop(0, '#f8e8ff');      // Core pearlescent highlight
        bodyGrad.addColorStop(0.18, '#d8b4fe');   // Lilac / violet
        bodyGrad.addColorStop(0.48, '#a855f7');   // Vivid purple
        bodyGrad.addColorStop(0.78, '#c2410c');   // Deep amber/orange transition
        bodyGrad.addColorStop(0.96, '#431407');   // Shadow rim
        bodyGrad.addColorStop(1, '#180226');
        
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        
        // 4. Secondary Warm Rim Light (simulating environment reflection from bottom-right)
        const rimGrad = ctx.createRadialGradient(cx + r * 0.45, cy + r * 0.45, 2, cx, cy, r);
        rimGrad.addColorStop(0, 'rgba(251, 146, 60, 0.65)');  // Warm orange rim
        rimGrad.addColorStop(0.5, 'rgba(249, 115, 22, 0.25)');
        rimGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = rimGrad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        
        // 5. Crisp Specular Glass Glare
        const specX = lightX - 4;
        const specY = lightY - 4;
        const specGrad = ctx.createRadialGradient(specX, specY, 1, specX, specY, r * 0.38);
        specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        specGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
        specGrad.addColorStop(0.7, 'rgba(238, 210, 255, 0.15)');
        specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = specGrad;
        ctx.beginPath();
        ctx.arc(specX, specY, r * 0.38, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Auto-instantiate when DOM loads
window.addEventListener('DOMContentLoaded', () => {
    window.dualMindOrb = new GlowingOrb('heroOrbCanvas');
});
