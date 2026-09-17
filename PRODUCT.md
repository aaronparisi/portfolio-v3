# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React Router v8 (framework mode, SSR), Vite 8, Tailwind CSS v4, TypeScript, @react-spring/web for animation. Pre-existing codebase; not a stack decision for this round.

## Users

Hiring managers, technical recruiters, and engineering leads evaluating Aaron Parisi as a frontend-developer candidate. They're scanning quickly, comparing against other candidates' portfolios, and looking for signal that the person can both build and design — not just recite a stack.

## Product Purpose

A personal portfolio site. Its job is to get a visitor to believe, within the first viewport, that Aaron is a capable, detail-oriented frontend engineer with real design taste — and to get them to reach out.

## Positioning

The differentiator a template portfolio can't copy: Aaron taught AP Calculus before writing code. The site's existing narrative spine is "the kind of kid who kept asking why" — a teacher's instinct for clarity and root-cause thinking, applied to frontend engineering. This round should sharpen that positioning through the *visual system itself* (not just copy) — the design should look like it was made by someone who thinks the way a mathematician/teacher thinks, not a generic dev-portfolio template.

## Operating Context

Single-page site: Hero, About, Journey (timeline), Skills, Contact/Footer. Deployed as a Docker container running `react-router-serve`; no backend, no database — all content is static/local. Hero photo already exists at `public/images/aaron-photo.jpg`.

## Capabilities and Constraints

- No CMS, no server-driven content — copy and data live in code/`app/data`.
- No image-generation tool available in this environment — visual assets are the existing hero photo plus whatever the user adds to the project directory, not AI-generated imagery.
- Local Python is 3.9.6, no Homebrew; the `img2threejs` skill needs Python 3.10+, which is not currently installed.

## Brand Commitments

- Existing narrative device: "the kind of kid who kept asking, why?" — pull-quote already anchors About.
- Existing hero animation: an integral (∫f(x)dx) morphing into `const solve = (x) => {...}` — the calculus→code pivot, already built with react-spring. This mechanism is durable brand material, not just decoration, and should be preserved or deepened rather than discarded, regardless of which visual world this round picks.
- Real hero photo of Aaron exists and is committed to the repo.

## Evidence on Hand

- Real endorsement quotes from three named former coworkers (Kyle, Peter, Ken), used in About.
- Real timeline/work history data in `app/data/timeline.ts`.
- No fabricated metrics, testimonials, or client logos exist or should be invented.

## Product Principles

1. The math-teacher-to-developer pivot is the one thing a competing portfolio cannot copy-paste — every visual decision should serve that story, not decorate around it.
2. Prove capability by demonstration (the site's own craft, motion, and code quality *is* the portfolio piece), not by claiming it in copy.
3. One committed visual world, executed all the way through — no mixed metaphors, no per-section theme drift.
4. Real content only: real quotes, real timeline, real photo. No invented stats or logos.
