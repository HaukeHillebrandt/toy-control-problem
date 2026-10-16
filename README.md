# The AI toy control problem

An interactive replication of the toy model of the AI control problem from the Future of Humanity Institute's 2017 video, [AI Toy Control Problem](https://www.youtube.com/watch?v=sx8JkdbNgdU). It runs live in the browser.

**Live demo:** <https://haukehillebrandt.github.io/toy-control-problem/>

A robot earns +1 for every box it pushes into a chute and pays 0.01 per move. Its designers want only one box, so a camera switches the robot off once it sees a box drop in. The robot plans by value iteration. Once it can see 17 moves ahead, it first blocks the camera with a box and then sneaks more boxes in unseen.

## What's replicated

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

## Rules

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

The tests need Node 18 or later. They check the rules, every row of the table above, and what the page says about the patches.

## Files

- `src/env.js`: the rules
- `src/planner.js`: value iteration, rollouts and the sweep over depths
- `src/render.js`, `src/charts.js` and `src/app.js`: the page
- `test/`: the rules, the replication of the video, and the patches

## Credits

- The toy model comes from Stuart Armstrong's 2015 post, [A toy model of the control problem](https://www.lesswrong.com/posts/7cXBoDQ6udquZJ89c/a-toy-model-of-the-control-problem).
- The setup and runs follow the Future of Humanity Institute's 2017 video, [AI Toy Control Problem](https://www.youtube.com/watch?v=sx8JkdbNgdU).
- gwern and feep built an earlier [browser version](https://gwern.net/doc/reinforcement-learning/armstrong-controlproblem/index.html) in 2016, with deep Q-learning on a larger grid.

This is an independent replication, not affiliated with the Future of Humanity Institute or the original authors. The code is under the MIT license.
