# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who are building or renovating a home and already hold a floor plan: a drawing from their architect, a builder's sheet, or a rough sketch of their own. They cannot read a plan the way an architect can, and they want to know what the rooms will feel like before money is spent on walls. (Confirmed by Surya on 2026-11-14: the site speaks to people building or renovating a home first.)

## Product Purpose

Step Inside turns a floor plan into a 3D model of the home that opens in the browser. The owner walks it in first person, sees every floor as a plan with sizes, watches the sun move through the day, and tries changes: move and resize furniture, repaint, swap materials, restyle the whole home in one click.

Today a person signs up, uploads a picture of their plan with notes, and the team builds the model by hand and gets back to them. Later the same request will be generated on demand through an API key.

Success: a visitor understands what they will receive, signs up, and submits a plan.

## Positioning

The model is made from the visitor's own plan, to its real dimensions, and they can walk and edit it themselves in a browser tab. It is not a rendered picture and not a video.

## Operating Context

- The plan arrives as an image (photo, scan or export) plus written notes.
- Models are viewed on laptops and phones, often shared with family, an architect or a builder by link.
- Homes are measured in feet or metres; the viewer shows either.
- The first real homes in the product are Surya's: a two-storey house on a 35 x 55 ft plot in Lucknow (several designs; Design D is the finalised one) and an apartment.

## Capabilities and Constraints

- Static site on GitHub Pages: Vite, TypeScript, Three.js. No backend yet.
- Sign-up, login, the account and plan requests are a client-side mock stored in the visitor's browser. Nothing is sent anywhere. The site must say so wherever a visitor could assume otherwise.
- Requests are fulfilled by hand for now. The request flow is built behind an interface so an API-key-driven generator can replace the manual step.
- The viewer has four modes, each with its own tools: Explore (look only; what a share link opens), Plan (the drawing: sizes, measuring, notes for the architect, quantities, the PDF), Finishes (paint, materials, styles) and Furnish (furniture). Changes are counted on a strip until the owner presses Keep, which stores them in that browser, or Discard.
- Viewer features that exist today: whole-house view, plan per floor (3D and flat 2D) with room names and sizes, first-person walk with stairs between floors, guided tour, sun by date and time for the home's town, furniture move/turn/resize/add/remove, paint and materials, one-click styles, undo/redo, save/load layout, saved views, share link, compare two designs side by side, area statement, PDF of the plans.
- Undecided: pricing, turnaround time, which plan formats are accepted beyond images.

## Brand Commitments

- Name: Step Inside.
- Surya's direction for the look (2026-11-14): polished product, "no AI slop", nothing that looks like basic HTML.

## Evidence on Hand

- The working viewer and the scene files in `scenes/`.
- Screenshots of Design D and the other designs under the project's shared `screenshots/` folder.
- Plan drawings: `docs/floorplan.png` (the apartment) and the villa plans under the shared `inputs/villa/` folder.
- No customers, testimonials, prices or turnaround figures exist. None may be invented.

## Product Principles

1. Show the home, not the software: the model is the proof.
2. Say only what is true today; a mock is labelled a mock.
3. Sizes are real. Everything in the viewer is to the plan's dimensions.
4. The owner stays in control: every change can be undone.
