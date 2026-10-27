---
name: focal-taste
description: Use the user's focal taste profile whenever they ask for recommendations (restaurants, films, books, music, travel, brands…), ask you to pick from or sort a list, or tell you something they love, like or dislike. Uses the focal MCP server's tools.
---

# focal taste profile

The `focal` MCP server holds the user's taste profile: things they love, like or dislike, vibes (styles such as "natural wine"), and hard rules ("never chains").

## When to use it

- **Before recommending anything**, call `read_profile` (or `taste_summary`) and ground suggestions in it. For fresh ideas, call `recommend` with a `type` and, for places, a `city`.
- **When the user shares a list** (search results, a menu of options, a reading list) and asks which to pick or how to order it, call `rank_list` with the names in their original order. Present lifted items first with their `label`, keep the rest in order, and never promote items the user dislikes.
- **When the user states a preference** ("I love Rintaro", "I can't stand horror"), save it with `add_thing` or `add_vibe`. Use `love`, `like` or `dislike`.
- **When the user states a hard rule** ("never show me chains"), call `propose_rule`. Tell them it stays pending until they approve it on the focal website.

## Rules

- If a save returns `saved: false` with `choices`, ask the user which one they meant and call again with the chosen `entity_id` or `tag_id`. Never pick for them.
- Only remove entries the user asked to remove (`remove_entry`). Every change appears in their focal activity as "via claude" and can be undone there.
- You cannot change focal settings; send the user to the website for that.
- If a tool call fails with an authentication error, ask the user to run `/mcp` and sign in to focal again.
