import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Cybernetic scramble text utility with characters "+?84564XERS"
const SCRAMBLE_CHARS = '+?84564XERS';

export function scrambleElement(element: HTMLElement, originalText?: string, duration = 1.2) {
  const text = originalText || element.getAttribute('data-original-text') || element.innerText.trim();
  if (!text) return;
  element.setAttribute('data-original-text', text);

  const length = text.length;
  let progress = 0;
  const startTime = performance.now();
  const durationMs = duration * 1000;

  function update(currentTime: number) {
    const elapsed = currentTime - startTime;
    progress = Math.min(elapsed / durationMs, 1);

    const revealedCount = Math.floor(progress * length);
    let output = '';

    for (let i = 0; i < length; i++) {
      if (text[i] === ' ' || text[i] === '\n') {
        output += text[i];
      } else if (i < revealedCount) {
        output += text[i];
      } else {
        const randomChar = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        output += randomChar;
      }
    }

    element.innerText = output;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.innerText = text;
    }
  }

  requestAnimationFrame(update);
}

export function initScrambleAnimations() {
  const elements = document.querySelectorAll<HTMLElement>('.scramble');
  elements.forEach((el, index) => {
    const text = el.innerText.trim();
    el.setAttribute('data-original-text', text);

    // Initial scramble with slight stagger
    setTimeout(() => {
      scrambleElement(el, text, 0.8 + Math.random() * 0.4);
    }, index * 100);

    // Periodic subtle re-scramble
    setInterval(() => {
      if (Math.random() > 0.6) {
        scrambleElement(el, text, 0.9);
      }
    }, 6000 + index * 1200);
  });

  // Secondary button hover scramble
  document.querySelectorAll<HTMLElement>('.button-secondary').forEach((btn) => {
    const scrambleEl = btn.querySelector<HTMLElement>('.scramble');
    if (scrambleEl) {
      btn.addEventListener('mouseenter', () => {
        scrambleElement(scrambleEl, undefined, 0.6);
      });
    }
  });
}

export function initHeroAnimations() {
  const hero = document.getElementById('hero');
  const bgAnim = hero?.querySelector<HTMLElement>('.bg-animation-hero');
  if (!hero || !bgAnim) return;

  const handleMouseMove = (e: MouseEvent) => {
    const rect = hero.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    gsap.to(bgAnim, {
      x: x * 35,
      y: y * 35,
      duration: 0.8,
      ease: 'power2.out',
    });
  };

  hero.addEventListener('mousemove', handleMouseMove);
}

export function initPartnersMarquee() {
  const partners = document.querySelector<HTMLElement>('.block-partners');
  if (partners) {
    gsap.to(partners, {
      xPercent: -50,
      ease: 'none',
      duration: 25,
      repeat: -1,
    });
  }

  const partnerMove = document.querySelector<HTMLElement>('.block-partner-move');
  const section = document.querySelector<HTMLElement>('.wrapper-partners');
  if (partnerMove && section) {
    gsap.to(partnerMove, {
      x: '-12vw',
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      },
    });
  }
}

export function initProductTrack() {
  const section = document.getElementById('product');
  if (!section) return;

  const aboutText = section.querySelector<HTMLElement>('.product-about-text');
  const aboutVisible = aboutText?.querySelector<HTMLElement>('.product-about-visible');
  const aboutCursor = aboutText?.querySelector<HTMLElement>('.product-about-cursor');
  const aboutScreenReader = aboutText?.querySelector<HTMLElement>('.product-about-screen-reader');
  const aboutCopy = aboutScreenReader?.textContent || '';

  const images = [
    section.querySelector<HTMLElement>('.block-image-product.v1'),
    section.querySelector<HTMLElement>('.block-image-product.v2'),
    section.querySelector<HTMLElement>('.block-image-product.v3'),
    section.querySelector<HTMLElement>('.block-image-product.v4'),
  ];

  const icons = [
    section.querySelector<HTMLElement>('.icon-product.v1'),
    section.querySelector<HTMLElement>('.icon-product.v2'),
    section.querySelector<HTMLElement>('.icon-product.v3'),
    section.querySelector<HTMLElement>('.icon-product.v4'),
  ];

  const logoCircles = [
    section.querySelector<HTMLElement>('.logo-circle-product.v1'),
    section.querySelector<HTMLElement>('.logo-circle-product.v2'),
    section.querySelector<HTMLElement>('.logo-circle-product.v3'),
    section.querySelector<HTMLElement>('.logo-circle-product.v4'),
  ];

  const titleTexts = [
    section.querySelector<HTMLElement>('.medium-big-text.color-gradient.animated-v1'),
    section.querySelector<HTMLElement>('.medium-big-text.color-gradient.animated-v2'),
    section.querySelector<HTMLElement>('.medium-big-text.color-gradient.animated-v3'),
    section.querySelector<HTMLElement>('.medium-big-text.color-gradient.animated-v4'),
  ];

  const descTexts = [
    section.querySelector<HTMLElement>('.small-text.align-right.animation-v1'),
    section.querySelector<HTMLElement>('.small-text.align-right.animation-v2'),
    section.querySelector<HTMLElement>('.small-text.align-right.animation-v3'),
    section.querySelector<HTMLElement>('.small-text.align-right.animation-v4'),
  ];

  const plusAnim = section.querySelectorAll<HTMLElement>('.block-mins .medium-text');

  const updateAboutText = (progress: number) => {
    if (!aboutVisible || !aboutCursor || !aboutCopy) return;

    // Leave a short lead-in and finish just before the product track ends.
    const typingProgress = Math.min(Math.max((progress - 0.04) / 0.9, 0), 1);
    const visibleCount = Math.floor(typingProgress * aboutCopy.length);
    aboutVisible.textContent = aboutCopy.slice(0, visibleCount);
    aboutCursor.classList.toggle('is-complete', visibleCount >= aboutCopy.length);
  };

  const renderProductProgress = (progress: number) => {
    const stagePosition = progress * 3;

    images.forEach((image, idx) => {
      if (!image) return;
      const distance = Math.abs(stagePosition - idx);
      const influence = Math.max(0, 1 - distance);
      const drift = Math.sin(progress * Math.PI * 2 + idx * 0.7);
      const brightness = 0.78 + influence * 0.32;
      const saturation = 0.62 + influence * 0.72;
      const shadowAlpha = 0.08 + influence * 0.38;

      gsap.set(image, {
        y: -6 - influence * 34 + drift * 3,
        x: drift * (2.5 - influence),
        rotateZ: drift * (0.8 - influence * 0.45),
        scale: 0.985 + influence * 0.055,
        filter: `brightness(${brightness}) saturate(${saturation}) drop-shadow(0 ${6 + influence * 5}px ${8 + influence * 7}px rgba(34, 158, 255, ${shadowAlpha}))`,
        zIndex: Math.round(1 + influence * 4),
      });

      const icon = icons[idx];
      if (!icon) return;
      const grayscale = Math.round((1 - influence) * 100);
      gsap.set(icon, {
        y: -5 - influence * 15 - drift * 2,
        x: -drift * 2,
        rotateZ: -drift * 1.6,
        scale: 0.96 + influence * 0.16,
        filter: `brightness(${0.72 + influence * 0.55}) contrast(${0.9 + influence * 0.22}) saturate(${0.65 + influence}) grayscale(${grayscale}%) drop-shadow(0 0 ${3 + influence * 9}px rgba(34, 158, 255, ${0.1 + influence * 0.65}))`,
      });
    });

    logoCircles.forEach((circle, idx) => {
      if (!circle) return;
      const influence = Math.max(0, 1 - Math.abs(stagePosition - idx));
      gsap.set(circle, {
        borderColor: `rgba(34, 158, 255, ${0.2 + influence * 0.8})`,
        backgroundColor: `rgba(34, 158, 255, ${influence * 0.16})`,
        scale: 0.96 + influence * 0.08,
      });
    });

    titleTexts.forEach((title, idx) => {
      if (!title) return;
      const influence = Math.max(0, 1 - Math.abs(stagePosition - idx));
      gsap.set(title, {
        display: 'block',
        autoAlpha: influence,
        y: (idx - stagePosition) * 34,
      });
    });

    descTexts.forEach((description, idx) => {
      if (!description) return;
      const influence = Math.max(0, 1 - Math.abs(stagePosition - idx));
      gsap.set(description, {
        display: 'block',
        autoAlpha: influence,
        y: (idx - stagePosition) * 22,
      });
    });

    plusAnim.forEach((plus, idx) => {
      const influence = Math.max(0, 1 - Math.abs(stagePosition - (idx % 4)));
      gsap.set(plus, {
        color: influence > 0.4 ? '#229eff' : '#4d4d4d',
        opacity: 0.28 + influence * 0.72,
        scale: 0.9 + influence * 0.2,
      });
    });
  };

  renderProductProgress(0);

  // ScrollTrigger manages the terminal-style explanation and four product stages.
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      updateAboutText(p);
      renderProductProgress(p);
    },
  });
}

export function initFeaturesCounting() {
  const section = document.querySelector<HTMLElement>('.content-feature');
  if (!section) return;

  const mask = section.querySelector<HTMLElement>('.radial-mask');
  const empty = section.querySelector<HTMLElement>('.circle-empty');
  const number = section.querySelector<HTMLElement>('.big-text');
  const thinBorder = section.querySelector<HTMLElement>('.wrapper-text-counting');

  if (mask && empty && number && thinBorder) {
    gsap.set(mask, {
      rotate: 0,
      scale: 0.95,
      filter: 'blur(6px)',
      opacity: 0.8,
      transformOrigin: '50% 50%',
    });
    gsap.set(thinBorder, {
      borderColor: 'rgba(156,163,175,0.35)',
    });
    gsap.set(empty, {
      scale: 1,
      filter: 'blur(10px)',
      opacity: 0.35,
    });
    gsap.set(number, { innerText: 0 });

    gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 75%',
        end: 'bottom 75%',
        scrub: 0.6,
      },
    })
    .to(mask, {
      rotate: 360,
      scale: 1.05,
      filter: 'blur(0px)',
      opacity: 1,
      ease: 'none',
    }, 0)
    .to(thinBorder, {
      borderColor: 'rgba(59,130,246,0.7)',
      ease: 'none',
    }, 0)
    .to(empty, {
      scale: 1.15,
      filter: 'blur(4px)',
      opacity: 0.55,
      ease: 'none',
    }, 0)
    .to(number, {
      innerText: 100,
      snap: { innerText: 1 },
      ease: 'none',
    }, 0);
  }

  // Continuous Orbit rotation animations
  const orbit1 = section.querySelector<HTMLElement>('.image-orbit.v1');
  const orbit2 = section.querySelector<HTMLElement>('.image-orbit.v2');
  const orbit3 = section.querySelector<HTMLElement>('.image-orbit.v3');
  const orbit4 = section.querySelector<HTMLElement>('.image-orbit.v4');

  if (orbit1) gsap.to(orbit1, { rotate: 360, duration: 25, repeat: -1, ease: 'none' });
  if (orbit2) gsap.to(orbit2, { rotate: -360, duration: 30, repeat: -1, ease: 'none' });
  if (orbit3) gsap.to(orbit3, { rotate: 360, duration: 35, repeat: -1, ease: 'none' });
  if (orbit4) gsap.to(orbit4, { rotate: -360, duration: 28, repeat: -1, ease: 'none' });

  const frameworkHeading = section.closest('.quen-framework')
    ?.querySelector<HTMLElement>('.quen-framework-heading');
  const frameworkLayers = section.querySelectorAll<HTMLElement>('.quen-framework-layer');

  if (frameworkHeading && frameworkLayers.length) {
    gsap.fromTo(
      frameworkHeading.children,
      { y: 48, opacity: 0.15 },
      {
        y: 0,
        opacity: 1,
        stagger: 0.08,
        ease: 'none',
        scrollTrigger: {
          trigger: frameworkHeading,
          start: 'top 90%',
          end: 'bottom 58%',
          scrub: true,
        },
      },
    );

    frameworkLayers.forEach((layer) => {
      const number = layer.querySelector<HTMLElement>('.quen-framework-number');
      const content = layer.querySelector<HTMLElement>(':scope > div');

      gsap.fromTo(
        [number, content].filter(Boolean),
        { x: 64, opacity: 0.12 },
        {
          x: 0,
          opacity: 1,
          stagger: 0.06,
          ease: 'none',
          scrollTrigger: {
            trigger: layer,
            start: 'top 92%',
            end: 'center 58%',
            scrub: true,
          },
        },
      );
    });
  }
}

export function initLabTrack() {
  const section = document.getElementById('lab');
  if (!section) return;

  const toggle = section.querySelector<HTMLElement>('.toggle');
  const toggleWrapper = section.querySelector<HTMLElement>('.wrapper-toggle');
  const manualText = section.querySelector<HTMLElement>('.medium-big-text.animated-1');
  const intelligentText = section.querySelector<HTMLElement>('.medium-big-text.animated-2');
  const scanBar = section.querySelector<HTMLElement>('.block-scan-lab');
  const scatterImg2 = section.querySelector<HTMLElement>('.image-content-lab.v2');
  const scatterImg3 = section.querySelector<HTMLElement>('.image-content-lab.v3');
  const delayedScramble = section.querySelector<HTMLElement>('.text-subcontent-hero .scramble.v1:first-child');
  const completedScramble = section.querySelector<HTMLElement>('.text-subcontent-hero .scramble.v1:last-child');
  const validationFailed = section.querySelector<HTMLElement>('.text-secondary.absolute');
  const validationSuccess = section.querySelector<HTMLElement>('.text-thirdly.opacity');
  const labPanels = section.querySelectorAll<HTMLElement>('.block-content-desc-lab');
  const fragmentedStates = section.querySelectorAll<HTMLElement>('.lab-state-fragmented');
  const unifiedStates = section.querySelectorAll<HTMLElement>('.lab-state-unified');

  let isIntelligent = false;

  function setMode(intelligent: boolean) {
    isIntelligent = intelligent;
    if (toggle) {
      gsap.to(toggle, { x: intelligent ? '2vw' : '0vw', duration: 0.35, ease: 'power2.out' });
    }
    if (manualText && intelligentText) {
      if (intelligent) {
        manualText.classList.add('muted');
        intelligentText.classList.remove('muted');
        intelligentText.classList.add('color-gradient');
      } else {
        manualText.classList.remove('muted');
        intelligentText.classList.add('muted');
        intelligentText.classList.remove('color-gradient');
      }
    }
    if (scatterImg2 && scatterImg3) {
      gsap.to(scatterImg2, { opacity: intelligent ? 0 : 1, duration: 0.4 });
      gsap.to(scatterImg3, { opacity: intelligent ? 1 : 0, duration: 0.4 });
    }
    if (delayedScramble && completedScramble) {
      delayedScramble.style.display = intelligent ? 'none' : 'block';
      completedScramble.style.display = intelligent ? 'block' : 'none';
    }
    if (validationFailed && validationSuccess) {
      gsap.to(validationFailed, { opacity: intelligent ? 0 : 1, duration: 0.3 });
      gsap.to(validationSuccess, { opacity: intelligent ? 1 : 0, duration: 0.3 });
    }
    if (fragmentedStates.length && unifiedStates.length) {
      gsap.to(fragmentedStates, {
        opacity: intelligent ? 0 : 1,
        duration: 0.22,
        overwrite: 'auto',
      });
      gsap.to(unifiedStates, {
        opacity: intelligent ? 1 : 0,
        duration: 0.22,
        overwrite: 'auto',
      });
    }
  }

  // Interactive manual click on toggle
  if (toggleWrapper) {
    toggleWrapper.style.cursor = 'pointer';
    toggleWrapper.addEventListener('click', () => {
      setMode(!isIntelligent);
    });
  }

  gsap.set(labPanels, {
    opacity: 0,
    y: 42,
    scale: 0.985,
    borderColor: 'rgba(255,255,255,0.16)',
    boxShadow: '0 0 0 rgba(37,144,255,0)',
  });
  gsap.set(fragmentedStates, { opacity: 1 });
  gsap.set(unifiedStates, { opacity: 0 });
  if (scanBar) gsap.set(scanBar, { xPercent: -125, yPercent: 0, opacity: 1 });
  if (manualText) gsap.set(manualText, { color: '#4b5563' });

  const labTimeline = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.65,
      onUpdate: (self) => {
        const unified = self.progress >= 0.62;
        if (unified !== isIntelligent) setMode(unified);
      },
    },
  });

  // Cycle the Fragmented label through system colors before it resolves to white.
  labTimeline
    .to(manualText, {
      keyframes: [
        { color: '#2468a9', duration: 0.05 },
        { color: '#7c3aed', duration: 0.05 },
        { color: '#208ef0', duration: 0.05 },
        { color: '#ffffff', duration: 0.07 },
      ],
      ease: 'none',
    }, 0.02)
    // Fragmented mode: build the dashboard panel by panel.
    .to(labPanels, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.18,
      stagger: 0.07,
      ease: 'power2.out',
    }, 0.12);

  if (scanBar) {
    // A narrow blue scan passes across the cards without covering the section.
    labTimeline.to(scanBar, {
      xPercent: 125,
      duration: 0.22,
      ease: 'power1.inOut',
    }, 0.5);
  }

  // The passing scan activates every card in sequence.
  labTimeline
    .to(labPanels, {
      filter: 'brightness(1.14)',
      borderColor: 'rgba(45,151,255,0.72)',
      boxShadow: 'inset 0 0 2rem rgba(24,126,235,0.1), 0 0 1.5rem rgba(24,126,235,0.08)',
      duration: 0.15,
      stagger: 0.035,
      ease: 'power2.out',
    }, 0.59)
    .to(section, { opacity: 1, duration: 0.01 }, 0.99);
}

export function initWorkflowTrack() {
  const section = document.getElementById('workflow');
  if (!section) return;

  const steps = [
    section.querySelector<HTMLElement>('.block-flow.v1'),
    section.querySelector<HTMLElement>('.block-flow.v2'),
    section.querySelector<HTMLElement>('.block-flow.v3'),
    section.querySelector<HTMLElement>('.block-flow.v4'),
  ];

  const icons = [
    section.querySelector<HTMLElement>('.icon-workflow.v1'),
    section.querySelector<HTMLElement>('.icon-workflow.v2'),
    section.querySelector<HTMLElement>('.icon-workflow.v3'),
    section.querySelector<HTMLElement>('.icon-workflow.v4'),
  ];

  const cards = [
    section.querySelector<HTMLElement>('.block-image-workflow.v1'),
    section.querySelector<HTMLElement>('.block-image-workflow.v2'),
    section.querySelector<HTMLElement>('.block-image-workflow.v3'),
    section.querySelector<HTMLElement>('.block-image-workflow.v4'),
  ];
  steps.forEach((step, idx) => {
    if (!step) return;
    gsap.set(step, {
      y: idx === 0 ? 0 : 120,
      opacity: idx === 0 ? 1 : 0,
      visibility: idx === 0 ? 'visible' : 'hidden',
    });
  });

  cards.forEach((card, idx) => {
    if (!card) return;
    gsap.set(card, {
      y: idx === 0 ? -24 : 22,
      z: idx === 0 ? 18 : -50 - idx * 12,
      scale: idx === 0 ? 1.03 : 0.92,
      opacity: idx === 0 ? 1 : 0.48,
      filter: idx === 0
        ? 'brightness(1.08)'
        : 'brightness(0.62)',
      transformPerspective: 900,
    });
  });

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      const sequenceProgress = Math.min(p / 0.82, 1);
      const phasePosition = sequenceProgress * 3;
      const settleProgress = gsap.utils.clamp(0, 1, (p - 0.82) / 0.18);

      steps.forEach((step, idx) => {
        if (!step) return;
        const offset = idx - phasePosition;
        const opacity = gsap.utils.clamp(0, 1, 1 - Math.abs(offset) * 1.08);
        gsap.set(step, {
          y: offset * 118,
          opacity,
          visibility: opacity > 0.015 ? 'visible' : 'hidden',
        });
      });

      icons.forEach((icon, idx) => {
        if (!icon) return;
        const distance = Math.abs(idx - phasePosition);
        const activation = gsap.utils.clamp(0, 1, 1 - distance);
        const completed = gsap.utils.clamp(0, 1, phasePosition - idx + 1);
        const visible = Math.max(activation, completed);
        gsap.set(icon, {
          filter: `brightness(${62 + visible * 53}%) grayscale(${100 - visible * 100}%)`,
          scale: 1 + activation * 0.06 * (1 - settleProgress),
        });
      });

      cards.forEach((card, idx) => {
        if (!card) return;
        const distance = Math.abs(idx - phasePosition);
        const activation = gsap.utils.clamp(0, 1, 1 - distance);
        const completed = gsap.utils.clamp(0, 1, phasePosition - idx + 1);
        const futureDepth = -50 - idx * 12;
        const activeY = -24 * activation;
        const activeZ = 18 * activation + futureDepth * (1 - completed);
        const activeScale = 0.92 + completed * 0.05 + activation * 0.06;

        gsap.set(card, {
          y: gsap.utils.interpolate(activeY, 0, settleProgress),
          z: gsap.utils.interpolate(activeZ, 0, settleProgress),
          scale: gsap.utils.interpolate(activeScale, 1, settleProgress),
          opacity: gsap.utils.interpolate(0.48, 1, Math.max(activation, completed)),
          filter: `brightness(${62 + Math.max(activation, completed) * 42}%)`,
        });
      });
    },
  });
}

export function initIntegrationTrack() {
  const section = document.getElementById('integration');
  if (!section) return;

  const v1 = section.querySelector<HTMLElement>('.icon-integration.v1');
  const v2 = section.querySelector<HTMLElement>('.icon-integration.v2');
  const v3 = section.querySelector<HTMLElement>('.icon-integration.v3');
  const v4 = section.querySelector<HTMLElement>('.icon-integration.v4');
  const v5 = section.querySelector<HTMLElement>('.icon-integration.v5');
  const v6 = section.querySelector<HTMLElement>('.icon-integration.v6');
  const v7 = section.querySelector<HTMLElement>('.icon-integration.v7');

  const titleWrap = section.querySelector<HTMLElement>('.wrapper-title-integration');
  const lineH = section.querySelector<HTMLElement>('.line-horizontal');

  if (!v4) return;

  gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.8,
    },
  })
  .fromTo(v4, { scale: 3 }, { scale: 1, ease: 'power1.out' }, 0)
  .fromTo(v1, { x: 0, y: 0, scale: 0.2, rotate: 0 }, { x: '-40vw', y: '8vw', scale: 1, rotate: -20, ease: 'power1.out' }, 0)
  .fromTo(v2, { x: 0, y: 0, scale: 0.4, rotate: 0 }, { x: '-26vw', y: '4vw', scale: 1, rotate: -16, ease: 'power1.out' }, 0)
  .fromTo(v3, { x: 0, y: 0, scale: 0.6, rotate: 0 }, { x: '-13vw', y: '1vw', scale: 1, rotate: -8, ease: 'power1.out' }, 0)
  .fromTo(v5, { x: 0, y: 0, scale: 0.2, rotate: 0 }, { x: '40vw', y: '8vw', scale: 1, rotate: 20, ease: 'power1.out' }, 0)
  .fromTo(v6, { x: 0, y: 0, scale: 0.4, rotate: 0 }, { x: '26vw', y: '4vw', scale: 1, rotate: 16, ease: 'power1.out' }, 0)
  .fromTo(v7, { x: 0, y: 0, scale: 0.6, rotate: 0 }, { x: '13vw', y: '1vw', scale: 1, rotate: 8, ease: 'power1.out' }, 0)
  .fromTo(titleWrap, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, ease: 'power1.out' }, 0)
  .fromTo(lineH, { scaleX: 0 }, { scaleX: 1, ease: 'power1.out' }, 0);
}

export function initPricingHover() {
  const section = document.querySelector<HTMLElement>('.join-quen');
  if (!section) return;

  const header = section.querySelector<HTMLElement>('.join-quen-header');
  const heading = section.querySelector<HTMLElement>('.join-quen-heading');
  const line = section.querySelector<HTMLElement>('.join-quen-line i');
  const cards = gsap.utils.toArray<HTMLElement>('.join-card', section);

  if (header && heading && line && cards.length) {
    gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 82%',
        end: 'bottom 42%',
        scrub: 0.65,
      },
    })
      .fromTo(header, { opacity: 0.25 }, { opacity: 1, ease: 'none' }, 0)
      .fromTo(heading, { y: 80 }, { y: 0, ease: 'none' }, 0)
      .fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: 'none' }, 0.08)
      .fromTo(
        cards,
        {
          y: (index) => 110 + index * 48,
          opacity: 0,
          scale: 0.94,
          rotateX: 9,
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotateX: 0,
          stagger: 0.14,
          ease: 'none',
        },
        0.18,
      );
  }

  cards.forEach((card) => {
    card.addEventListener('mouseenter', () => {
      gsap.to(card, {
        y: -8,
        boxShadow: '0 1.4rem 4rem rgba(0, 82, 185, 0.18)',
        borderColor: 'rgba(42, 151, 255, 0.55)',
        duration: 0.3,
      });
    });
    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        y: 0,
        boxShadow: 'none',
        borderColor: card.classList.contains('is-featured')
          ? 'rgba(39, 145, 255, 0.52)'
          : 'rgba(255, 255, 255, 0.11)',
        duration: 0.3,
      });
    });
  });
}

export function initAllAnimations() {
  initScrambleAnimations();
  initHeroAnimations();
  initPartnersMarquee();
  initProductTrack();
  initFeaturesCounting();
  initLabTrack();
  initWorkflowTrack();
  initIntegrationTrack();
  initPricingHover();
}
