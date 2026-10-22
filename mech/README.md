# FS-07A Vanguard: mobile suit tech demo

A three.js prototype of a Gundam/Robotech-style mech on a desert test range. The
mech walks, boost-dashes, jump-jets, and fires beam rifles, cannons and full
missile salvos. Everything is procedural geometry textured from the two sheets
in `textures/`. There is no build step.

## Run it

Serve the repository root with any static server and open `/mech/`:

```sh
npx http-server -p 8080 .
# then visit http://localhost:8080/mech/
```

three.js 0.170.0 loads from jsDelivr, so the first load needs a network connection.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W` `A` `S` `D` | Left thumb stick |
| Aim | Mouse (click to capture), arrow keys | Drag the right side |
| Lock on / switch target (press again to release) | `T` | LOCK |
| Right-hand weapon | Left mouse | FIRE |
| Left-hand weapon / raise shield | Right mouse | L |
| Shoulder cannons (vulcan, beam cannon) | `F` or middle mouse | CNN |
| Single missile | `Q` | MSL |
| Full missile salvo | `E` | SALVO |
| Jump (hold to jet upward) | `Space` | JUMP |
| Boost dash | `Shift` | DASH |
| Reload | `R` | Reload |
| Hangar / pause | `Tab`, `M`, or `Esc` | Hangar |
| Camera zoom | Mouse wheel | |

The lock-on button holds one target. Aimed weapons lead it, the arms track it,
the camera keeps it in view, and single missiles go to it first. When it is
destroyed the lock moves to the next target in view.

Missiles lock onto targets inside the dashed circle. A salvo spreads its missiles
across every lock; with nothing locked they fly to the crosshair.

## Hangar

The hangar sets the loadout for six hardpoints (both hands, both shoulders, both
legs), a frame paint scheme, and one of eight colorways per weapon. It has five
presets and settings for sound, shadows, look sensitivity, inverted look and
render resolution. The loadout and settings are saved in `localStorage`.

Weapons, from the weapon sheet:

- **BR-07 Beam Rifle**: fast pink beam bolts
- **HB-90 Hyper Bazooka**: heavy rockets with back-blast and smoke trails
- **MG-79 Machine Gun**: spinning rotary barrels and tracers
- **SC-12 Shotgun Cannon**: ten-pellet spread
- **GL-6 Grenade Launcher**: rotating drum, arcing shells
- **MBC-2 Mega Beam Cannon**: charge, then a sustained beam (hand or shoulder)
- **VP-4 Vulcan Pod**: shoulder gatling
- **MP-6 Missile Pod**: 6 homing missiles behind an opening hatch (shoulder or leg)
- **HMP-8 Heavy Missile Pod**: 8 large missiles (shoulder)
- **μMP-24 Micro Missile Pod**: 24 swarming micro missiles (shoulder or leg)
- **RX-S Shield**: left forearm, raised with the left trigger

## Design notes

The suit follows Armored Core's style:
- **Silhouette:** tall, hunched frame, narrow waist, long arms with heavy forearms.
- **Armor:** sharp, faceted plates that sweep backward.
- **Head:** a low arrowhead sensor head with a V visor, sitting between raised collar plates.
- **Legs:** blade knees, thin shins and talon feet with heel spurs.
- **Back:** a booster pack with swept stabilizer fins. Missile pods and cannons mount on top of it.
- **Paint:** dark armor over a gold-trimmed frame. The default is Lynx Navy; Unsung Black, Shrieker Steel, Glint White, Desert Ops and Crimson are in the hangar.

The thrusters are built to read as real hardware:

- **Main engines:** two bell nozzles hang from armored housings under the backpack.
  - Each sits in a gimbal ring with hydraulic rams. The rams stretch as the bell swings back for a dash and down for a climb.
  - The bells are heat-tinted, gold at the throat shading to blue at the lip, and glow inside when lit.
- **Backpack verniers:** small nozzles on the pack's upper corners.
- **Calf verniers:** each sits in a recessed bay behind a two-piece armored cover that swings open when they fire.
- **Heel verniers:** set into a notch at the back of each foot.
- **Exhaust:** a camera-facing plume with shock diamonds, a turbulent inner shell and an exit glow. A light and a ground glow wash the area under the suit during a climb.

Armor plates are cut straight from the body sheet: `js/pieces.js` holds the
outlines of the sheet's panels, traced in sheet pixels. `pieceGeo()` in
`js/atlas.js` extrudes a plate to that outline and maps the panel's art onto
its face, so the E-07 hatch, R-07 forearm plate, shin plates, hazard pads and
DANGER intake panel all keep their painted shapes on the model. An inverted-hull
pass (`addOutline()`) draws ink outlines for the anime look; it can be turned off
in the hangar settings.

## Code map

| File | What it does |
| --- | --- |
| `js/regions.js` | Pixel rectangles of the panels used from each texture sheet |
| `js/pieces.js` | Traced outlines of the cut-out armor pieces on the body sheet |
| `js/atlas.js` | Texture loading, box-projected atlas UVs, geometry helpers, paints and skins |
| `js/mech.js` | Mech model, gimbaled bell-nozzle thrusters with plume shaders, procedural walk/dash/jump/aim animation |
| `js/weapons.js` | Weapon definitions and models, projectiles, homing missiles, lock-on |
| `js/fx.js` | Instanced billboard particles (smoke, fire, sparks), explosions, light pool, decals |
| `js/world.js` | Sky, ground, props, colliders, raycasts, target drones and boards |
| `js/audio.js` | Synthesized Web Audio sound effects |
| `js/input.js` | Keyboard, pointer lock and touch controls |
| `js/ui.js` | HUD and hangar menu |
| `js/main.js` | Renderer, player physics, camera, game loop |

The atlas mapping in `atlas.js` (`mapUV`) assigns each triangle to one of six
directions by its normal and maps it into the region chosen for that direction,
cropping the region to the face's aspect ratio so panels never stretch. To
re-skin a part, change the region names passed in its `faces` object.
