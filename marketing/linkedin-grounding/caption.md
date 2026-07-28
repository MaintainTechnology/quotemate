# Post: the model is not allowed to write a price

Six-slide document post. Upload `out/quotemax-grounding.pdf` as a LinkedIn
**document**, not as images.

## Document title

```
Our AI is not allowed to write a price
```

39 characters. The claim is the hook, and it is doing the work the caption's
first line would otherwise have to do twice.

## Caption

Post this from a personal profile. It is a point of view, and points of view
need a person attached.

```
Our AI is not allowed to write a price.

That sounds like we shipped it broken. It is the part I am proudest of.

Every tool calling itself AI quoting has the same thing underneath. A language
model has read a lot of quotes, so it will happily produce something that looks
like one. It cannot tell you where the figure came from, because there is no
where. It made it up.

For a tradie that is not a rounding error. That is your margin.

So QuoteMax works the other way around. The model runs the conversation and
works out what the job actually is. Then it calls your rate book for every
single line. A lookup, not a guess. It writes the sentence around a number it
was handed.

Then a check runs across the finished quote. If one line cannot be traced back
to your book for that trade, the whole quote is void. Not the line. The quote.
It lands in your dashboard flagged instead of landing on your customer.

And when a job genuinely cannot be priced that way, nobody guesses. It books a
$99 site visit, credited straight back off the work when you win it.

The conversation is AI. The money is not.

Six slides on how that actually works, below.

If you are building with language models: where do you draw the line between
what the model decides and what it is only ever allowed to look up?

#AIQuoting #Tradies #AustralianBusiness #BuildingInPublic #AppliedAI
```

## Why this is the post to run

Speed is not a position. Every competitor will claim quotes in under a minute,
and a claim everyone makes persuades nobody. This one is defensible, it is
technically true, and it answers the single biggest objection in the market
without arguing with it.

It also reaches two audiences at once. Tradies read it as "my prices are safe."
The builder and founder crowd read it as a real engineering decision, and they
are the ones who reshare.

## First comment

```
The check is the boring part and it does the most work. Every line item has to
resolve against the tradie's own pricing book for that specific trade. Miss
once, the quote never leaves the building.

quotemax.com.au
```

## The closing question

The question at the end is aimed at builders, not tradies, and that is
deliberate. A tradie will comment "how much" whether you prompt them or not.
Engineers will only comment if you give them something to disagree with, and
their comments are what carries a post past your own followers.

If you would rather point it at the trade audience, swap the last line for:

```
Tradies: would you hand your pricing to something that could not show you where
a number came from? Genuine question.
```

## Accuracy note

Every claim in the deck and the caption is real, not positioning:

- Money-touching model steps are tool-calling only, so the model has no path to
  emit a figure it was not given.
- The grounding validator requires each line to derive from the pricing book,
  shared assemblies, or the tenant's own assemblies, scoped to that trade.
- A single failure downgrades the entire quote to the $99 inspection route.
  That is genuinely quote-level, not line-level.
- Roofing, solar and painting go further again: their pricers are pure
  functions with no model anywhere in the money path.

If any of that changes in the product, this post has to change with it.
