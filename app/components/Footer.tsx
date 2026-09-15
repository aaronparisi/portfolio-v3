import type { ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { PinIcon, MailIcon, PhoneIcon, ArrowUpRightIcon } from "./icons";
import { Reveal } from "./Reveal";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

function ContactLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const [style, api] = useSpring(() => ({ y: 0, config: { tension: 320, friction: 18 } }));

  return (
    <animated.a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
      onPointerEnter={() => !reduced && void api.start({ y: -3 })}
      onPointerLeave={() => void api.start({ y: 0 })}
      style={{ transform: style.y.to((y) => `translate3d(0, ${y}px, 0)`) }}
      className="flex items-center gap-2 text-[var(--ink-soft)] transition-colors hover:text-[var(--accent)]"
    >
      {icon}
      {children}
    </animated.a>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer id="contact" className="border-t border-[var(--border)] px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <Reveal>
          <p className="eyebrow">Contact</p>
          <h2 className="mt-2 font-display text-4xl text-[var(--ink)] sm:text-5xl">
            Let&rsquo;s build <em className="text-[var(--accent)]">something</em>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--ink-soft)]">
            Open to frontend roles with room to grow alongside product and design.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 font-mono text-sm">
            <span className="flex items-center gap-2 text-[var(--ink-soft)]">
              <PinIcon className="h-4 w-4" /> Seattle, WA
            </span>
            <ContactLink href="mailto:parisi.aaron@gmail.com" icon={<MailIcon className="h-4 w-4" />}>
              parisi.aaron@gmail.com
            </ContactLink>
            <ContactLink href="tel:+15185733522" icon={<PhoneIcon className="h-4 w-4" />}>
              518-573-3522
            </ContactLink>
            <ContactLink href="https://linkedin.com/in/aaron-parisi" icon={null}>
              LinkedIn <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </ContactLink>
          </div>

          <p className="mt-16 font-mono text-xs text-[var(--ink-soft)]">
            © {year} Aaron Parisi. Built with React Router, TypeScript, Tailwind &amp; react-spring.
          </p>
        </Reveal>
      </div>
    </footer>
  );
}
