# In-game verification checklist

Everything in this project comes from the wiki. These builds test the
assumptions the wiki cannot settle. Enter each one, open the stat screen
(or the Found HUD for exact numbers), and write the real values in the
'actual' column.

The three marked ORDERING TEST matter most: they decide whether range
multipliers apply before or after additive range, which is undocumented and
currently a guess extrapolated from the fire-rate rule.

| character | items | expected dmg | tears | speed | range | shot spd | luck | actual | what it tests |
|---|---|---|---|---|---|---|---|---|---|
| Isaac | (none) | 3.50 | 2.73 | 1.00 | 6.50 | 1.00 | 0.0 |  | baseline: confirms base stats and the 2.73 tears figure |
| Isaac | The Sad Onion | 3.50 | 3.45 | 1.00 | 6.50 | 1.00 | 0.0 |  | simplest tears-up, through the piecewise delay |
| Isaac | Pentagram | 5.19 | 2.73 | 1.00 | 6.50 | 1.00 | 0.0 |  | single damage up, confirms the sqrt |
| Isaac | Pentagram, Pentagram | 6.45 | 2.73 | 1.00 | 6.50 | 1.00 | 0.0 |  | NOTE: needs Diplopia etc. Confirms diminishing returns |
| Isaac | Cricket's Head, Magic Mushroom | 7.35 | 2.73 | 1.30 | 9.00 | 1.00 | 0.0 |  | the non-stacking 1.5x group: should be 1.5x total, not 2.25x |
| Isaac | Polyphemus | 15.00 | 1.15 | 1.00 | 6.50 | 1.00 | 0.0 |  | flat damage bypassing the sqrt |
| Isaac | Soy Milk | 0.70 | 15.00 | 1.00 | 6.50 | 1.00 | 0.0 |  | fire rate multiplier, 0.2x damage |
| Isaac | Cricket's Body | 3.50 | 3.23 | 1.00 | 5.20 | 1.00 | 0.0 |  | ORDERING TEST: 0.8x range multiplier on base 6.5 |
| Isaac | Cricket's Body, Mom's Pearls | 3.50 | 3.23 | 1.00 | 7.20 | 1.00 | 1.0 |  | ORDERING TEST: +2.5 range AND 0.8x. add-then-multiply = 7.2, multiply-then-add = 7.7 |
| Isaac | My Reflection | 5.86 | 2.73 | 1.00 | 16.00 | 1.60 | -1.0 |  | ORDERING TEST: 2x + 1.5 range in one item |
| Azazel | (none) | 5.25 | 0.86 | 1.25 | 4.50 | 1.00 | 0.0 |  | innate x0.267 fire rate multiplier |
| Keeper | (none) | 4.20 | 1.06 | 0.90 | 6.50 | 1.00 | -2.0 |  | innate triple shot and x1.20 damage |
| Samson | (none) | 3.50 | 2.50 | 1.10 | 5.00 | 1.31 | 0.0 |  | shot speed 1.31, tears -0.1 |
| Eve | (none) | 2.62 | 2.73 | 1.23 | 6.50 | 1.00 | 0.0 |  | damage x0.75 |
| Isaac | Haemolacria | 7.79 | 0.94 | 1.00 | 5.20 | 1.00 | 0.0 |  | tear delay x2 + 11; multiply-then-add should give 31 delay |
| Isaac | Odd Mushroom (Thin) | 2.64 | 4.43 | 1.30 | 6.50 | 1.00 | 0.0 |  | x0.9 damage-up multiplier with -0.4 damage |

## Also worth checking

- **Range for Sacred Heart / Godhead.** The wiki says their range bonus was
  removed in Repentance, so we show none. Confirm the stat screen agrees.
- **20/20 / The Inner Eye.** Damage per tear and tears/sec should match the
  table; the shot count is separate and only affects DPS.
- **Tears cap.** Stack tears ups past +1.82 and confirm tears stops at 5.00
  with no direct fire-rate items.
- **Dark Prince's Crown.** Its +2.0 fire rate should break that 5.00 cap.
