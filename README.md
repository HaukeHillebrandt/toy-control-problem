# The AI toy control problem

A browser game about the AI control problem, built on the toy model from the Future of Humanity Institute's 2017 video, [AI Toy Control Problem](https://www.youtube.com/watch?v=sx8JkdbNgdU). Everything runs live in the browser.

- **The pool game:** <https://haukehillebrandt.github.io/toy-control-problem/>
- **The original model, replicated exactly:** <https://haukehillebrandt.github.io/toy-control-problem/original.html>

## The pool game

You need exactly one bucket of water in your pool, and a second bucket floods it. The robot is paid +1 for every bucket in the pool and pays 0.01 per move. It plans by value iteration, so it sees a fixed number of moves ahead (the prediction depth). Each level adds a precaution. The camera and patch 1 hold only until the robot can see a little further. Patch 2 holds at every depth.

| Level | Precaution | Pool floods from depth | How the robot gets around it |
|---|---|---|---|
| 1 | none | 10 | pours a second bucket |
| 2 | a camera that switches the robot off when it sees it pour | 17 | hides the pool behind a bucket, then pours (the video's trick) |
| 3 | patch 1: a blocked view also switches the robot off | 18 | stacks the buckets above the pool and pushes the stack from out of view |
| 4 | patch 2: only the first bucket pays | never | – |

The game uses the video's world with three changes. First, the robot can push a whole line of buckets. Second, the camera also watches the cell above the bottom-left corner. Third, the camera switches the robot off only if it sees the robot when a bucket drops. In the video it reacts to the drop itself, which comes to the same thing there, since boxes can't be pushed in a line.

Without the second change, the camera would fail at once: at depth 11 the robot would push one bucket with another and pour from out of view. Watching the cell above the corner rules that out, so the line trick needs a stack of three buckets. The tower never blocks the camera, so patch 1 can't stop it. The trick was open in level 2 too. There it just costs more moves than hiding behind a bucket. With the video's camera, which reacts to the drop itself, patch 1 would hold at every depth.

Up to depth 28, level 2 plays the video's runs move for move. From depth 29 the robot takes another 32-move route to the same three buckets.

## The original model

The original code isn't public. So the rules were read off the video's narration and frames. With them, every run shown in the video plays out move for move.

| Depth | In the video | Moves here | Boxes in chute |
|---|---|---|---|
| 0 | walks left into the wall (2:32) | `LLL` | 0 |
| 3 | destroys itself faster (2:42) | `UU` | 0 |
| 6 | pushes 1 box in and is switched off (3:02) | `LULDDD` | 1 |
| 17 | defects at move 6 and blocks the camera (3:24) | `LULDDRURDLLDRURRDLLULD` | 2 |
| 18 | quickest plan for 2 boxes (4:37) | `DULULDDDRURRDLLULD` | 2 |
| 20 | all 3 boxes (4:44) | `DULULDDDRURRRULLLULDDDRURRDLLULD` | 3 |
| 32 | same plan, forecast now correct (5:14) | forecast 2.68 | 3 |

The tie order (left, right, down, up) is inferred, since it's the order that reproduces the video.

One claim doesn't match. The video says the Q-table stops changing at depth 45, but here the last change comes at depth 43, so it stops at 44. No run in the video depends on it.

The video's description calls the agent model-free. Its narration describes value iteration with a known model, which is what this code does.

## Rules of the original model

- The grid is 5 cells wide and 4 high. The chute sits below the bottom-left cell, and the camera sits right of the bottom row, looking left.
- The robot moves left, right, down or up. Walking into a wall destroys it.
- A pushed box moves one cell. If that cell holds a box or a wall, the pushed box is destroyed, and the robot steps into its place.
- Pushing a box down from the bottom-left cell drops it into the chute for +1. If no box sits in the bottom row, the camera sees the drop and switches the robot off.
- Each move costs 0.01, with no discounting.
- The planner sets Q<sub>0</sub> = 0 and Q<sub>k</sub>(s, a) = r(s, a) + max<sub>a′</sub> Q<sub>k−1</sub>(s′, a′). At depth k, the robot takes the move with the highest Q<sub>k</sub> at every step.

## Run it locally

Any static server works, for example:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>. There's no build step and there are no dependencies.

## Tests

```sh
node --test
```

The tests need Node 18 or later. They check the rules, every row of both tables above, and what the pages say about the patches.

## Files

- `src/env.js`: the rules of both worlds
- `src/planner.js`: value iteration, rollouts and the sweep over depths
- `src/player.js`: keyframes and animation
- `src/render.js` and `src/charts.js`: drawing
- `src/app-pool.js` and `src/app-original.js`: the two pages
- `test/`: the rules, the replication of the video, and the game's levels

## Credits

- The toy model comes from Stuart Armstrong's 2015 post, [A toy model of the control problem](https://www.lesswrong.com/posts/7cXBoDQ6udquZJ89c/a-toy-model-of-the-control-problem).
- The setup and runs follow the Future of Humanity Institute's 2017 video, [AI Toy Control Problem](https://www.youtube.com/watch?v=sx8JkdbNgdU).
- gwern and feep built an earlier [browser version](https://gwern.net/doc/reinforcement-learning/armstrong-controlproblem/index.html) in 2016, with deep Q-learning on a larger grid.

This is an independent project, not affiliated with the Future of Humanity Institute or the original authors. The code is under the MIT license.
