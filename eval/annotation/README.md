# Annotation guide

Two tasks support the evaluation. Each annotator works alone, fills in a copy of each sheet, and does not look at the repository, the original labels or the system's output while labelling. Open the CSV files in Excel or LibreOffice (they are UTF-8; Urdu text displays correctly). Save the result under a new name, for example `task-a-posts.annotator2.csv`, keeping the columns and the `item_id` values unchanged.

Expected time: about 3 hours for Task A and 2 to 3 hours for Task B. Take breaks; it is fine to do the tasks on different days.

## Task A: label posts and page likes

Sheets: `task-a-posts.csv` (200 posts) and `task-a-likes.csv` (80 page likes).

### Language (posts only)

Write one code in the `language` column:

| Code | Use for |
|---|---|
| `en` | English |
| `es` | Spanish |
| `ur` | Urdu, in either Urdu script or Latin letters (Roman Urdu) |

If a post mixes languages, choose the language of most of its words. If you cannot tell, write `?` and explain in `notes`.

### Sentiment (posts only)

Label the overall feeling that the writer expresses or clearly implies about what they describe. Judge the post as a reader would, not by counting positive or negative words.

| Code | Use for | Examples |
|---|---|---|
| `pos` | Pleased, proud, excited, grateful, amused | "Passed my driving test first time!!" |
| `neg` | Annoyed, sad, worried, tired, complaining | "Third parcel this month left out in the rain" |
| `neu` | Informational, or no clear feeling either way | "Library opens at 9 on Saturdays from next week" |

Sarcasm counts as what the writer means: "Great, another Monday" said about bad news is `neg`. Label Spanish and Urdu posts in the same way.

### Topics (posts and likes)

Write zero or more topic codes, separated by semicolons, for what the post or page is about. Leave the cell empty if no topic applies. For likes, use the page name and category together.

| Code | Covers |
|---|---|
| `technology` | Computers, software, gadgets, the internet, programming |
| `education` | School, university, courses, exams, studying, learning |
| `work_career` | Jobs, workplaces, colleagues, interviews, promotions, businesses |
| `travel` | Trips, holidays, flights, commuting, visiting places |
| `food_drink` | Cooking, eating out, recipes, drinks, cafés |
| `sports_fitness` | Sport, exercise, the gym, running, teams and matches |
| `music` | Music, bands, concerts, playing instruments |
| `film_tv` | Films, series, television, streaming shows |
| `arts_culture` | Books, reading, art, museums, theatre, festivals, culture |
| `family_relationships` | Family, children, partners, friends, weddings |
| `health_wellbeing` | Illness, sleep, mental health, wellbeing, medical care |
| `news_politics` | News, politics, government, public services, the economy |
| `gaming` | Video games, game streaming, board games |
| `nature_outdoors` | Nature, parks, hiking, gardens, the outdoors, weather |
| `pets_animals` | Pets and other animals |

Only tag a topic the post is clearly about, not one it merely mentions in passing.

## Task B: rate the model's output

Sheets: `task-b-guesses.csv` (53 attribute guesses) and `task-b-sentences.csv` (169 generated sentences). These were produced by a language model reading the same synthetic posts. The sheets do not show whether the system accepted or rejected each item; rate each one on its own.

### Attribute guesses (`task-b-guesses.csv`)

Each row gives an attribute (for example `location` or `relationship_status`), the model's guess, and every quote it cited together with the full post the quote came from.

- `valid_value`: write `yes` if the guess is a sensible value for that attribute, otherwise `no`. For example, "pet owner" is not a relationship status, and "18-24" is a valid age range. Personality attributes (`openness`, `conscientiousness`, `extraversion`, `agreeableness`) take a short description of behaviour.
- `support`: does the cited text, read in its full post, support the guess?
  - `supported`: the quotes directly state or strongly imply the guess, and they are about the account holder.
  - `partly`: the quotes are relevant but leave real doubt, or support only part of the guess.
  - `unsupported`: the quotes do not support the guess, are about someone else, or require a stereotype or a large leap.

Use only the quotes and posts shown, not your own guess about the persona.

### Generated sentences (`task-b-sentences.csv`)

Each row gives a sentence shown to the user and the findings it cites, as JSON (`value` and `n` for each cited finding).

- `faithful`:
  - `yes`: every claim in the sentence is correct according to the cited findings, including numbers, units and hours. Rounding is fine if the rounded number is correct.
  - `partly`: some claims are correct and at least one is wrong or not supported by the cited findings.
  - `no`: the main claim is wrong or not supported by the cited findings.

A sentence that presents a model guess as an established fact counts as `partly`. If the JSON is hard to read, use the `notes` column to say what you could not check.

## After annotation

Put the completed files in this folder and run:

```sh
node eval/annotation/agreement.js <annotator-suffix>
```

for example `node eval/annotation/agreement.js annotator2`. It reports agreement with the original labels (Task A) or between two raters (Task B, which needs two suffixes), and writes the disagreements to a file for adjudication.

Regenerate the blank sheets with `node eval/annotation/make-sheets.js`.
