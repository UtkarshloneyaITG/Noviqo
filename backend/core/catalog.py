"""
Catalog — every inventory item, the milestones that award them, and the
coin / rank-point maths. Pure data and functions; ids are part of the
client contract, so don't rename them.
"""
from typing import Dict, List, Optional

STARTER_CHARACTERS = ["char:m-Casual", "char:m-Casual2", "char:w-Casual", "char:w-Worker"]

_CHARACTER_NAMES = {
    "m-Adventurer": "Explorer", "m-Beach": "Beach day", "m-Casual": "Casual", "m-Casual2": "Hoodie",
    "m-Farmer": "Farmer", "m-King": "The King", "m-Punk": "Punk", "m-Spacesuit": "Astronaut",
    "m-Suit": "Sharp suit", "m-Swat": "Tactical", "m-Worker": "Builder",
    "w-Adventurer": "Ranger", "w-Casual": "Laid-back", "w-Formal": "Gala", "w-Medieval": "Knight",
    "w-Punk": "Punk rocker", "w-SciFi": "Starfarer", "w-Soldier": "Commander", "w-Suit": "Executive",
    "w-Witch": "The Witch", "w-Worker": "Mechanic",
}
_CHARACTER_PRICES = {
    "m-Beach": 250, "m-Farmer": 250, "m-Worker": 250, "m-Suit": 250, "w-Formal": 250, "w-Suit": 250,
    "m-Punk": 400, "w-Punk": 400, "m-Adventurer": 400, "w-Adventurer": 400, "w-Medieval": 400,
    "m-Swat": 600, "w-Soldier": 600, "w-SciFi": 600,
}

MILESTONES: List[dict] = [
    {"id": "first_game", "name": "First game", "description": "Finish your first game.", "stat": "games", "goal": 1, "reward": "emotes:party"},
    {"id": "first_win", "name": "First win", "description": "Win a game.", "stat": "wins", "goal": 1, "reward": "back:gold"},
    {"id": "games_10", "name": "Regular", "description": "Finish 10 games.", "stat": "games", "goal": 10, "reward": "felt:midnight"},
    {"id": "ranked_win_1", "name": "Ranked winner", "description": "Win a ranked game.", "stat": "ranked_wins", "goal": 1, "reward": "char:w-Witch"},
    {"id": "ranked_gold", "name": "Gold rank", "description": "Reach Gold in ranked.", "stat": "rp", "goal": 600, "reward": "back:midnight"},
    {"id": "wins_25", "name": "Champion", "description": "Win 25 games.", "stat": "wins", "goal": 25, "reward": "char:m-King"},
    {"id": "games_50", "name": "Veteran", "description": "Finish 50 games.", "stat": "games", "goal": 50, "reward": "char:m-Spacesuit"},
]
_MILESTONE_REWARD = {m["reward"]: m["id"] for m in MILESTONES}


def _item(item_id: str, kind: str, name: str, price: Optional[int] = None) -> dict:
    milestone = _MILESTONE_REWARD.get(item_id)
    return {"id": item_id, "kind": kind, "name": name, "price": price, "milestone": milestone,
            "starter": price is None and milestone is None}


ITEMS: List[dict] = (
    [_item(f"char:{k}", "character", n, _CHARACTER_PRICES.get(k)) for k, n in _CHARACTER_NAMES.items()]
    + [_item("back:classic", "card_back", "Classic"), _item("back:gold", "card_back", "Gold"),
       _item("back:midnight", "card_back", "Midnight"), _item("back:crimson", "card_back", "Crimson", 150),
       _item("back:ocean", "card_back", "Ocean", 150), _item("back:neon", "card_back", "Neon", 400)]
    + [_item("felt:green", "felt", "Green"), _item("felt:midnight", "felt", "Midnight"),
       _item("felt:crimson", "felt", "Crimson", 300), _item("felt:ocean", "felt", "Ocean", 300),
       _item("felt:violet", "felt", "Violet", 300)]
    + [_item("emotes:basic", "emotes", "Basic emotes"), _item("emotes:party", "emotes", "Party emotes")]
    + [_item("lobby:rooftop", "lobby", "Rooftop dusk"), _item("lobby:synthwave", "lobby", "Synthwave", 300),
       _item("lobby:beach", "lobby", "Moonlit beach", 300), _item("lobby:aurora", "lobby", "Aurora peaks", 400),
       _item("lobby:station", "lobby", "Orbital station", 500),
       _item("lobby:sakura", "lobby", "Sakura dawn", 450)]
    # How your character appears on its lobby pedestal (frontend: three/world/entrances.js)
    + [_item("entry:classic", "entry", "Classic"), _item("entry:skydrop", "entry", "Sky drop", 300),
       _item("entry:teleport", "entry", "Teleport", 300), _item("entry:rise", "entry", "Rising platform", 300),
       _item("entry:tornado", "entry", "Tornado", 400), _item("entry:smoke", "entry", "Smoke bomb", 400),
       _item("entry:lightning", "entry", "Lightning strike", 500), _item("entry:confetti", "entry", "Confetti blast", 500),
       _item("entry:portal", "entry", "Portal", 600), _item("entry:hologram", "entry", "Hologram", 600),
       _item("entry:hero", "entry", "Hero landing", 800)]
)
ITEM_BY_ID: Dict[str, dict] = {i["id"]: i for i in ITEMS}
STARTER_ITEMS: List[str] = [i["id"] for i in ITEMS if i["starter"]]
SLOT_OF_KIND = {"character": "character", "card_back": "card_back", "felt": "felt", "lobby": "lobby", "entry": "entry"}   # emotes aren't equipped

# Lobby emotes (your character acts them out on its pedestal) → the emote pack that unlocks each.
LOBBY_EMOTES: Dict[str, str] = {
    **dict.fromkeys(["wave", "cheer", "thumbs_up", "clap", "laugh", "think", "shrug"], "emotes:basic"),
    **dict.fromkeys(["dance", "salute", "bow", "flex"], "emotes:party"),
}
DEFAULT_EQUIPPED = {"character": "char:m-Casual", "card_back": "back:classic", "felt": "felt:green", "lobby": "lobby:rooftop",
                    "entry": "entry:classic"}

# ── coins and rank points ────────────────────────────────────────────────

_COINS = [50, 30, 20]


def coins_for(placement: int) -> int:
    return _COINS[placement - 1] if 1 <= placement <= len(_COINS) else 10


def rp_delta(placement: int, players: int) -> int:
    """Ranked points for finishing `placement` of `players`: +30 for first down
    to -15 for last, curved so the middle leans positive; rounded to 5."""
    if players < 2:
        return 0
    raw = -15 + 45 * ((players - placement) / (players - 1)) ** 1.3
    return int(5 * round(raw / 5))


_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"]
_DIVS = ["III", "II", "I"]
MASTER_RP = 1500


def rank_info(rp: int) -> dict:
    """300 RP per tier, 100 per division (III → II → I); Master from 1500."""
    rp = max(0, int(rp))
    if rp >= MASTER_RP:
        return {"rp": rp, "tier": "Master", "label": "Master", "next_label": None, "into": rp - MASTER_RP, "span": 0}
    tier, rem = divmod(rp, 300)
    div, into = divmod(rem, 100)
    if div < 2:
        nxt = f"{_TIERS[tier]} {_DIVS[div + 1]}"
    else:
        nxt = f"{_TIERS[tier + 1]} III" if tier + 1 < len(_TIERS) else "Master"
    return {"rp": rp, "tier": _TIERS[tier], "label": f"{_TIERS[tier]} {_DIVS[div]}", "next_label": nxt, "into": into, "span": 100}


def stat_value(account: dict, stat: str) -> int:
    return account["rp"].get("uno", 0) if stat == "rp" else account["stats"].get(stat, 0)


def milestone_progress(account: dict) -> List[dict]:
    return [
        {"id": m["id"], "progress": min(stat_value(account, m["stat"]), m["goal"]), "goal": m["goal"],
         "unlocked": m["id"] in account["unlocked"]}
        for m in MILESTONES
    ]


def public_catalog() -> dict:
    """What the client gets in the `catalog` message."""
    return {"items": ITEMS,
            "milestones": [{k: m[k] for k in ("id", "name", "description", "goal", "reward")} for m in MILESTONES],
            "emotes": [{"id": e, "pack": p} for e, p in LOBBY_EMOTES.items()]}
