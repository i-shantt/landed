"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  Building2,
  Check,
  CheckCheck,
  CircleCheck,
  Fingerprint,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "@/components/landed/Brand";

const flow = [
  {
    number: "01",
    label: "Pause",
    title: "Hold the destination.",
    emphasis: "Until it is verified.",
    icon: LockKeyhole,
  },
  {
    number: "02",
    label: "Verify",
    title: "Verify with evidence.",
    emphasis: "From a trusted contact.",
    icon: Fingerprint,
  },
  {
    number: "03",
    label: "Land",
    title: "Release the payment.",
    emphasis: "Track its arrival.",
    icon: CheckCheck,
  },
];

function Action({
  children = "Get started",
  secondary = false,
  href = "/cases",
}: {
  children?: React.ReactNode;
  secondary?: boolean;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={`lp-action ${secondary ? "lp-action-light" : ""}`}
    >
      <span>{children}</span>
      <span className="lp-action-arrow">
        <ArrowUpRight size={20} />
      </span>
    </Link>
  );
}

function EnterprisePreview() {
  return (
    <div
      className="lp-hero-art lp-enterprise-preview"
      aria-label="Illustrative Landed workspace with simulated case data"
    >
      <div className="lp-product-window">
        <div className="lp-product-titlebar">
          <Brand />
          <span>Meridian Outdoor Co.</span>
          <span className="lp-product-demo">Demo workspace</span>
        </div>
        <div className="lp-product-body">
          <aside>
            <span className="lp-preview-nav-active">
              <ShieldCheck size={13} />
              Verifications
            </span>
            <span>
              <Building2 size={13} />
              Vendors
            </span>
            <span>
              <Mail size={13} />
              Mailbox
            </span>
            <span>
              <CheckCheck size={13} />
              Payments
            </span>
          </aside>
          <div className="lp-product-main">
            <div className="lp-product-heading">
              <h2>Verification cases</h2>
              <span>
                <ArrowUpRight size={11} />
                New verification
              </span>
            </div>
            <div className="lp-product-metrics">
              <div>
                <span>Payments on hold</span>
                <strong>
                  $33,250<span>.00</span>
                </strong>
              </div>
              <div>
                <span>Needs review</span>
                <strong>2</strong>
              </div>
              <div>
                <span>Closed</span>
                <strong>1</strong>
              </div>
            </div>
            <div className="lp-product-tabs">
              <strong>All cases</strong>
              <span>Needs attention</span>
              <span>Closed</span>
            </div>
            <div className="lp-product-table">
              <div className="lp-product-table-head">
                <span>Vendor</span>
                <span>Status</span>
                <span>Amount held</span>
              </div>
              {[
                {
                  name: "Granite Ridge",
                  initials: "GR",
                  state: "Recovery",
                  amount: "$23,400.00",
                  tone: "risk",
                },
                {
                  name: "Bluewater Textiles",
                  initials: "BT",
                  state: "Needs review",
                  amount: "$9,850.00",
                  tone: "review",
                },
                {
                  name: "NorthPeak Logistics",
                  initials: "NP",
                  state: "Closed",
                  amount: "$0.00",
                  tone: "closed",
                },
              ].map((row) => (
                <div className="lp-product-table-row" key={row.name}>
                  <span>
                    <i>{row.initials}</i>
                    {row.name}
                  </span>
                  <span className={`lp-preview-status lp-preview-${row.tone}`}>
                    {row.state}
                  </span>
                  <strong>{row.amount}</strong>
                </div>
              ))}
            </div>
            <div className="lp-product-security">
              <ShieldCheck size={14} />
              <strong>Unverified destinations remain blocked.</strong>
              <LockKeyhole size={12} />
            </div>
          </div>
        </div>
      </div>
      <div className="lp-product-control">
        <div className="lp-control-heading">
          <span className="lp-control-fingerprint">
            <Fingerprint size={30} />
          </span>
          <CircleCheck size={22} />
        </div>
        <strong>Destination verified.</strong>
        <div className="lp-control-account">
          <Building2 size={15} />
          <span>NorthPeak ··3456</span>
          <Check size={15} />
        </div>
      </div>
    </div>
  );
}

function FlowScene({ step }: { step: number }) {
  const StepIcon = flow[step].icon;
  return (
    <div
      className={`lp-flow-scene lp-scene-${step}`}
      aria-label="Illustrative verification workflow with simulated payment data"
    >
      <div className="lp-scene-circles" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="lp-scene-card" key={step} aria-live="polite">
        <div className="lp-scene-icon">
          <StepIcon size={28} />
        </div>
        {step === 0 ? (
          <>
            <h3>
              New bank details.
              <br />
              Same trusted vendor?
            </h3>
            <div className="lp-account-row">
              <Building2 size={20} />
              <div>
                <strong>NorthPeak Logistics</strong>
                <span>Requested account ··3456</span>
              </div>
              <span className="lp-scene-pill">On hold</span>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <h3>
              A tiny deposit.
              <br />A meaningful check.
            </h3>
            <div className="lp-call">
              <span>
                <AudioLines size={22} />
              </span>
              <div>
                <strong>Contact of record</strong>
              </div>
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="lp-quote">“I can confirm the deposit.”</div>
          </>
        ) : (
          <>
            <h3>
              Right destination.
              <br />
              <span className="lp-accent-text">Safely landed.</span>
            </h3>
            <div className="lp-scene-amount">
              $18,250<span>.00</span>
            </div>
            <div className="lp-account-row">
              <span className="lp-initials">NP</span>
              <div>
                <strong>NorthPeak Logistics</strong>
                <span>Receipt confirmed · Demo payment</span>
              </div>
              <CircleCheck size={20} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty(
        "--page-progress",
        `${max > 0 ? window.scrollY / max : 0}`,
      );
      el.style.setProperty(
        "--hero-offset",
        `${reduced.matches ? 0 : Math.min(window.scrollY, 900) * 0.12}px`,
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            reveal.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]").forEach((node) =>
      reveal.observe(node),
    );
    el.dataset.motionReady = "true";
    const steps = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting)
            setActiveStep(
              Number((entry.target as HTMLElement).dataset.flowStep),
            );
        }),
      { rootMargin: "-28% 0px -42% 0px", threshold: 0 },
    );
    el.querySelectorAll("[data-flow-step]").forEach((node) =>
      steps.observe(node),
    );
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      reveal.disconnect();
      steps.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
      delete el.dataset.motionReady;
    };
  }, []);

  function goToStep(index: number) {
    setActiveStep(index);
    document.getElementById(`journey-${index}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  }

  return (
    <div className="landing-v2" ref={root}>
      <div className="lp-scroll-progress" aria-hidden="true" />
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <header className="lp-header lp-container">
        <Link href="/" aria-label="Landed home">
          <Brand />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">The process</a>
          <a href="#why-landed">Why Landed</a>
        </nav>
        <Link href="/cases" className="lp-nav-cta">
          Enter workspace <ArrowUpRight size={17} />
        </Link>
      </header>
      <main id="main">
        <section className="lp-hero lp-container">
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-hero-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="lp-hero-copy">
            <h1>
              <span>Vendor payments.</span>
              <span>Verified before</span>
              <span className="lp-accent-text">release.</span>
            </h1>

            <div className="lp-hero-actions">
              <Action />
              <a href="#how-it-works" className="lp-watch-link">
                <span>
                  <ArrowDown size={17} />
                </span>
                How it works
              </a>
            </div>
          </div>
          <EnterprisePreview />
          <div
            className="lp-hero-stages"
            aria-label="Payment verification process"
          >
            {flow.map(({ number, label, icon: Icon }) => (
              <div key={number}>
                <span className="lp-stage-number">{number}</span>
                <Icon size={17} />
                <span>{label}</span>
                <span className="lp-stage-line" aria-hidden="true" />
              </div>
            ))}
          </div>
        </section>
        <section className="lp-features lp-container" id="why-landed">
          <div className="lp-section-heading" data-reveal>
            <div>
              <h2>
                Payment control.
                <br />
                <span className="lp-accent-text">At every stage.</span>
              </h2>
            </div>
          </div>
          <div className="lp-bento">
            <article className="lp-bento-destination" data-reveal>
              <div className="lp-bento-heading">
                <span className="lp-round-icon">
                  <ShieldCheck size={21} />
                </span>
              </div>
              <h3>
                New destinations.
                <br />
                <span className="lp-accent-text">
                  Independent verification.
                </span>
              </h3>

              <div className="lp-bank-visual">
                <div>
                  <span className="lp-bank-initials">NP</span>
                  <strong>NorthPeak Logistics</strong>
                  <ArrowUpRight size={16} />
                </div>
                <div className="lp-bank-digits">
                  •••• &nbsp; •••• &nbsp; 3456
                </div>
                <div className="lp-bank-bottom">
                  <span>
                    <LockKeyhole size={10} /> Verification required
                  </span>
                </div>
              </div>
            </article>
            <article
              className="lp-bento-contact"
              data-reveal
              style={{ "--reveal-delay": "90ms" } as CSSProperties}
            >
              <div className="lp-bento-heading">
                <span className="lp-round-icon">
                  <Fingerprint size={22} />
                </span>
              </div>
              <div className="lp-contact-visual" aria-hidden="true">
                <div className="lp-contact-ring" />
                <span className="lp-contact-person">
                  JC
                  <span>
                    <Check size={11} />
                  </span>
                </span>
              </div>
              <h3>
                Trusted contacts.
                <br />
                <span className="lp-accent-text">Bound confirmations.</span>
              </h3>
            </article>
            <article
              className="lp-bento-control"
              data-reveal
              style={{ "--reveal-delay": "160ms" } as CSSProperties}
            >
              <span className="lp-round-icon">
                <ShieldCheck size={22} />
              </span>
              <div>
                <h3>
                  AI-assisted intake.
                  <br />
                  <span className="lp-accent-text">
                    Human-controlled release.
                  </span>
                </h3>
              </div>
            </article>
            <article className="lp-bento-trail" data-reveal>
              <div>
                <h3>
                  Verification.
                  <br />
                  Payment.
                  <br />
                  <span className="lp-accent-text">Audit.</span>
                </h3>
              </div>
              <div className="lp-trail-visual">
                {[
                  { icon: Mail, label: "Bank change detected" },
                  {
                    icon: Fingerprint,
                    label: "Account verified",
                  },
                  { icon: CheckCheck, label: "Payment landed" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label}>
                    <span>
                      <Icon size={16} />
                    </span>
                    <strong>{label}</strong>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
        <section className="lp-process" id="how-it-works">
          <div className="lp-container">
            <div className="lp-process-heading" data-reveal>
              <h2>
                From bank change
                <br />
                <span className="lp-accent-text">to verified destination.</span>
              </h2>

              <span className="lp-process-arrow" aria-hidden="true">
                <ArrowDown size={30} />
              </span>
            </div>
            <div className="lp-process-layout">
              <div className="lp-flow-copy">
                {flow.map(({ number, title, emphasis, icon: Icon }, i) => (
                  <article
                    key={number}
                    id={`journey-${i}`}
                    data-flow-step={i}
                    className={`lp-flow-step ${activeStep === i ? "is-active" : ""}`}
                  >
                    <span className="lp-flow-number">
                      {number}
                      <span />
                    </span>
                    <div>
                      <Icon className="lp-flow-copy-icon" size={25} />
                      <h3>
                        {title}
                        <br />
                        <span className="lp-accent-text">{emphasis}</span>
                      </h3>
                    </div>
                  </article>
                ))}
              </div>
              <div className="lp-sticky-scene">
                <div
                  className="lp-flow-tabs"
                  role="group"
                  aria-label="Explore verification steps"
                >
                  {flow.map(({ label }, i) => (
                    <button
                      type="button"
                      key={label}
                      aria-pressed={activeStep === i}
                      onClick={() => goToStep(i)}
                    >
                      <span>0{i + 1}</span>
                      {label}
                      <span className="lp-tab-dot" />
                    </button>
                  ))}
                </div>
                <FlowScene step={activeStep} />
              </div>
            </div>
          </div>
        </section>
        <section className="lp-manifesto lp-container" data-reveal>
          <h2>
            Control every destination.
            <br />
            <span className="lp-accent-text">Before funds move.</span>
          </h2>
          <Link href="/cases" className="lp-text-cta">
            See what certainty looks like <ArrowUpRight size={24} />
          </Link>
        </section>

        <section className="lp-final">
          <div className="lp-final-orbit" aria-hidden="true" />
          <div className="lp-container">
            <div className="lp-final-main" data-reveal>
              <h2>
                Payment controls.
                <br />
                <span className="lp-accent-text">
                  Built into your workflow.
                </span>
              </h2>
              <div>
                <Action secondary>Let’s get started</Action>
              </div>
            </div>
            <footer className="lp-footer">
              <Link href="/" aria-label="Landed home">
                <Brand />
              </Link>

              <Link href="/about">
                About this prototype <ArrowUpRight size={15} />
              </Link>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
