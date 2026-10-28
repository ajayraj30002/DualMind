/**
 * DualMind - Interactive Dynamic Neural Brain Controller
 * Provides smooth 3D perspective tracking, harmonic floating physics,
 * and interactive synaptic burst discharges for the center-stage neural core.
 */
class DynamicNeuralCore {
    constructor() {
        this.targetX = 0;
        this.targetY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.isHovered = false;
        
        this.init();
    }

    init() {
        // Track mouse movement across the page to gently tilt the neural brain
        window.addEventListener('mousemove', (e) => {
            const wrap = document.querySelector('.orb-visual-wrap');
            if (!wrap) return;
            
            const rect = wrap.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            // Normalized offset between -1 and 1
            const dx = (e.clientX - centerX) / (window.innerWidth / 2);
            const dy = (e.clientY - centerY) / (window.innerHeight / 2);
            
            this.targetX = Math.max(-1, Math.min(1, dx));
            this.targetY = Math.max(-1, Math.min(1, dy));
        }, { passive: true });

        // Add interactive synaptic burst when clicking the brain
        document.addEventListener('click', (e) => {
            const wrap = e.target.closest('.orb-visual-wrap');
            if (!wrap) return;
            this.triggerSynapticDischarge(wrap);
        });

        this.startLoop();
    }

    startLoop() {
        const loop = () => {
            // Damped spring interpolation (lerp)
            this.currentX += (this.targetX - this.currentX) * 0.08;
            this.currentY += (this.targetY - this.currentY) * 0.08;

            const wrap = document.querySelector('.orb-visual-wrap');
            if (wrap) {
                const rotX = -this.currentY * 13;
                const rotY = this.currentX * 13;
                wrap.style.transform = `perspective(700px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
            }

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    triggerSynapticDischarge(wrap) {
        // Temporarily accelerate synapse nodes and bridge sparks
        const sparks = wrap.querySelectorAll('.synaptic-bridge-spark');
        const nodes = wrap.querySelectorAll('.synaptic-node');
        
        sparks.forEach(s => {
            s.style.stroke = '#ffffff';
            s.style.strokeWidth = '3px';
            s.style.filter = 'drop-shadow(0 0 10px #ffffff)';
        });
        
        nodes.forEach(n => {
            n.style.fill = '#ffffff';
            n.style.transform = 'scale(1.5)';
        });

        setTimeout(() => {
            sparks.forEach(s => {
                s.style.stroke = '';
                s.style.strokeWidth = '';
                s.style.filter = '';
            });
            nodes.forEach(n => {
                n.style.fill = '';
                n.style.transform = '';
            });
        }, 600);
    }
}

// Global initialization
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        window.dualMindNeuralCore = new DynamicNeuralCore();
    });
}
