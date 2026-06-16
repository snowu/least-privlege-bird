# Ideas

Status legend: ✅ done · ⚠️ partial · ❌ not started

## Gameplay
- ❌ Make harder but funnier. Introduce random events but make sure the game never feels unfair and challenges can be overcome.
- ✅ There's a physical limit to how gameplay is coded. With pipes spawning at "random" heights, as spawn increasing happens (around 15/20) it can happen that some pipes are too close
  horizontally but too spaced vertically so it's physically impossible to get to it. That's not good gameplay. Either keep speed increase but make pipe spawn less spaced or increase
  avatar vertical gravity/weight to accommodate and make the game more challenging but possible.
  *(`physics-core.ts` has `PIPE_GAP_MIN`/`PIPE_INTERVAL_MIN` floors specifically to prevent this.)*
- ❌ POWER-UPS???????????????

## Graphics
- ❌ BG/Parallax/effect changing as difficulty increases
- ❌ Introduce some 3D effect with ThreeJS (could tie this to gameplay)
- ❌ Curio to experiment with something to push avatar to the forefront (fake crash into screen and break it, as a banal example)
- ⚠️ Remove Wanderers from Robot. Make futurama tubes more vertical and source-like.
  *(Tubes already have a steep riser + perspective vanishing-point tube, but the flying-car traffic layer still uses the shared `wanderers` engine.)*
- ✅ Underwater pipes could be ancient columns.
  *(Monkey theme pipes are coral-crusted rock pillars with barnacles — DK Country reef vibes.)*
- ❌ What about having 1/3 column types per environment and rotate? Or rather have a base 1 and 2 random/rare ones.
  *(Each theme still has exactly one `drawPipe` style.)*

## UI/UX
- ✅ I instinctively press High Scores instead of login and play because it's under the avatars. Let's move the high scores to a corner or avatar in a place that feels natural
  for the flow: pick name, avatar and click play.
  *(High Scores is now a corner badge, pulled out of the name → avatar → play flow.)*
- ✅ Also, high score page is scuffed. Make it look nicer, colored trophy icons near top 3, etc. Lots of space to extend and highlight winners; style should follow pixel/round.
  *(Redesigned: avatar icons per row, gold/silver/bronze IAM-tier badges for top 3, current-player highlight, pixel/round-aware.)*
- ✅ / ❌ Use monkey instead of squid for water level, as a gamer callback to Donkey Kong's water level, the only good water level in existence.
  Whenever we implement HARD mode, we can do it like the Zelda one and make physics all fucked up for that level in hard mode.
  *(Monkey/DK swap is done. Hard mode doesn't exist yet.)*
- ✅ Avatar change screen at game over is too small overall.
  *(Reworked into a wrapping 2-row grid sized to fit all avatars.)*

## Avatars
- ❌ Mosquito avatar, bzzz sound
- ❌ Hay Fever Katie

## Arch
- ⚠️ Buildings and billboards logic can probably be unified.
  *(`adBillboard` is shared between Airplane and Horse, but Robot's skyline buildings use their own separate inline drawing.)*
- ⚠️ Sound engine. This could be a big-ass problem down the line, not sure about expansion capabilities. We need a discovery.
  *(`AudioFX` is still a small ad-hoc Web Audio oscillator setup — no scalability decision made yet.)*

## Easter Eggs
- ❌ More variance in game over messages. Fortune message could be put there instead of cowsay in the corner — sometimes it's quite fun. Keep cowsay everywhere only on startup.
  *(Game-over messages are still just "New high score!" / "Best: X" / blank; fortune cow currently shows on both menu and game-over.)*
- ⚠️ More IASIP, Community, Firefly stuff.
  *(Firefly + Futurama references exist in the Robot theme's billboard ads; no IASIP or Community references yet.)*
- ❌ Troy/Ripley, Abed/Alien avatar, with references to each other as Wanderers. Fuck bees and boring shit, we go all in.
