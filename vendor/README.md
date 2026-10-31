# Vendored code

`day-trader-skill/` is an unmodified copy of https://github.com/Jakeschincariol/day-trader-skill
at commit `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd` (MIT, see its LICENSE). FinEngine calls its tools from
`scripts/skill_desk.py`; update by replacing the folder and re-running its tests:

    python3 -m unittest discover -s vendor/day-trader-skill/tests
