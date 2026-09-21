# Two Jackpots Wild Wheel — local playable build

Solo, turn-based slot game for desktop and touch devices. The player spins three reels,
manages a local credit balance and adjustable total bet, wins on five fixed paylines, and
triggers the Wild Wheel when all nine cells match. A full screen of Sevens pays the wheel
twice. The strip layout, paytable, jackpot wheel and theoretical values come directly from
the supplied GDD and prototype.

The first meaningful action is one click/tap/Space press. The main view keeps balance, bet,
last win, jackpot ladder and the five paylines readable at once. Settings expose sound,
reduced motion and session reset. A deterministic `seed` query parameter and QA outcomes
make rare-event testing reproducible without changing normal play.
