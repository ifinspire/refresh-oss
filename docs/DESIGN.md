# Interface direction

This version was designed using the **frontend-design** plugin from
**claude-plugins-official**, applying its design-plan, review and visual-critique
workflow from the locally installed skill.

The main task is choosing and improving a photo. The three screens are Gallery,
Reconstruction and Settings. There is no promotional landing screen.

## Design plan

- Color: white `#FFFFFF`, cool paper `#F4F4F6`, ink `#28262C`, secondary text
  `#706C76`, divider `#E6E4E9`, and the existing magenta `#C8156B` for actions.
- Type: locally installed Avenir Next with Segoe UI and sans-serif fallbacks.
  Friendly, compact titles; 14–16px interface text. No external font requests.
- Layout: a quiet navigation rail, a contact sheet for the gallery, and a large
  photo beside a narrow tool column for reconstruction. Left-aligned labels.
  On phones, navigation becomes a top row and photo tools stack below the image.
- Principle: the photograph carries the personality. Color marks actions and
  selections. Explain a choice at the point of use; hide technical records until asked.

```text
Gallery                    Reconstruction                  Settings
[nav] Your photos  [+]     [nav] < Gallery / photo          [nav] Settings
      [photo] [photo]           [Original | versions]           Image server
      name    name              [large comparison] [tools]     address / model
      [photo] [photo]           [comparison slider] [create]    save and check
                                [past versions]                test image
```

## Review against the brief

The former page combined a marketing introduction, setup form, photo library,
editor, job feed and examples. Simply restyling those panels would preserve the
problem. The new hierarchy gives each task its own screen, moves examples to a
picker, groups results under their original photo, and keeps setup out of the
photo flow. Technical transparency remains in expandable prompt and work details.
