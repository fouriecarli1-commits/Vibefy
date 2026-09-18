# What else we could sell

Anré asked, on the night of 18 September 2026, for creative thinking about what more
this product could offer. This is that thinking, written down rather than built.

**Nothing here is built.** PART 11 of the brief says not to add a feature that is not in
the brief without asking first, and asking first is the point of this file. Each entry
is written so that the answer can be yes, no, or not yet, without a conversation first:
what it is, who pays, what it needs that we do not already have, what could go wrong,
and roughly how big it is.

The order is my recommendation, best first. Three of them I would build next week; the
rest are here because the reasoning is worth keeping even where the answer is no.

A note that applies to every line below. We sell an opinion about other people's
software, and the only reason anybody should care about that opinion is that nothing
they pay us can change it. Several attractive ideas fail on that alone, and they are
listed with the reason rather than quietly left out — because they will occur to
somebody else later, and the reasoning should already be here when they do.

---

## 1. A free pre-flight, for the person who built it

**What.** Paste your own URL and get, in under a minute and without an account, the ten
things that most often fail — the ones we find on nearly every first assessment. No
badge, no score, no report: a list of what would come up, with the evidence.

**Who pays.** Nobody. It is the top of the funnel, and it is the honest kind: somebody
who runs it and finds nothing has learnt something true, and somebody who runs it and
finds six things has a reason to buy an assessment that we did not have to argue for.

**What it needs.** Almost nothing new. `/trust-check` already does this shape of work,
from outside, on one page, with no account — but it is written for a _consumer_ deciding
whether to pay somebody. The same machinery pointed at the builder, with the builder's
questions, is a page and a prompt rather than a system.

**What could go wrong.** It has to be obviously not an assessment, or the free thing
becomes the product and the mark means nothing. Different name, different page, no
score, and it says so.

**Size.** Small. Two or three days.

---

## 2. Where you stand, against your own kind

**What.** A percentile in the report: this application scored 71, which is above 62% of
the assessed applications in its category. Nothing else in a report answers "is that
good", and it is the first question everybody asks.

**Who pays.** It belongs in the paid report, and it is the kind of thing that makes
somebody re-assess in three months to watch the number move.

**What it needs.** We already hold every score and every category. What it needs is a
rule for when there are too few applications in a category to say anything — which is
now, for most categories — and the discipline to print "not enough assessed applications
in this category to compare" rather than a percentile computed from four.

**What could go wrong.** Two ways. A percentile from a small sample is a number that
looks like knowledge and is not. And it must never name another application: "better
than Kettle" is a claim about Kettle that Kettle did not agree to.

**Size.** Small, and it gets better on its own as the directory fills.

---

## 3. A badge-status endpoint anybody can call

**What.** One public, unauthenticated URL that answers, for a badge id: is this live,
what was it assessed against, and when does it expire. Rate-limited, cacheable, no keys.

**Who pays.** Nobody directly, and that is the argument for it. A marketplace that wants
to show our mark beside a listing, a directory of AI tools, a platform that wants to
require an assessment before publishing — none of them will build against something they
have to negotiate for first. It is how the mark spreads to places we would never sell to.

**What it needs.** The signing and revocation already work exactly this way: the badge is
served per request, which is what makes revocation instant. This is the same answer in
JSON, plus a rate limit and a cache header.

**What could go wrong.** It has to answer about a badge, never about an application we
have not assessed — "no badge" and "we have never heard of this" are different answers
and one of them is not ours to give.

**Size.** Small. The hard parts exist.

---

## 4. A trust page we host, for people who have nothing to link to

**What.** The verification page already is one. Extended: the badge, the assessment
summary, the policies the customer has published, a real contact route, and the
"how hard is it to leave" rating, at one address the customer can link to from their
own footer.

**Who pays.** The customer, as part of a plan. Every larger company has one of these
pages and every small one knows they should.

**What it needs.** Most of the content exists. What it needs is a decision about how
much of it the customer writes themselves, because the moment they can type into it, it
stops being only our claim and starts being partly theirs — and a reader cannot tell
which half is which unless we make it obvious on the page.

**What could go wrong.** Exactly that. A page that mixes what we found with what the
customer says about themselves, without a visible line between them, is worse than
either one alone.

**Size.** Medium.

---

## 5. An accessibility statement, drafted from what we actually found

**What.** After the WCAG pass, a draft statement the customer can publish: what conforms,
what does not, what is planned, and how to report a barrier. Drafted from the findings
rather than from a template, which is what makes it worth anything.

**Who pays.** The customer, as an add-on or in a plan.

**What it needs.** The findings, which exist. And the discipline the brief already
insists on for legal text: it is a draft, it is not legal advice, and it says so on its
face. We are not lawyers and an accessibility statement is a public legal claim.

**What could go wrong.** Somebody publishes it unread and it says something untrue about
their application. So it should be generated with the gaps left visible rather than
filled in — the places where they have to write something themselves are the places we
cannot honestly write it for them.

**Size.** Medium.

---

## 6. A profile for the person, not only the application

**What.** A page for a builder: the applications they have had assessed, with the badges
that are still live. For somebody who builds fast and wants to be taken seriously, that
is a thing to link to from a CV or a proposal.

**Who pays.** Nobody at first. It could become part of a plan later.

**What it needs.** Consent, explicitly and separately. Listing somebody's applications
together tells a story about them personally, and it must be theirs to switch on, off,
and back off again — including for one application and not another.

**What could go wrong.** A profile page that cannot be taken down, or that keeps
showing an application somebody has moved on from, is a reputation we have taken custody
of without being asked.

**Size.** Medium.

---

## 7. A browser extension that says whether the site you are on has a badge

**What.** A small mark in the toolbar, lit when the site you are looking at carries a
live badge, and a click through to what it covers.

**Who pays.** Nobody. It is reach.

**What it needs.** The endpoint in idea 3, and a store listing per browser, which is a
real ongoing cost in review time rather than in code.

**What could go wrong.** An extension that sees every page somebody visits is an
extension that could collect every page somebody visits. Ours must not, and must be
built so that it visibly cannot — checked locally against a cached list, never by asking
our server about each site.

**Size.** Medium, with a permanent tail of store reviews.

---

## 8. Assessments bought by the marketplace instead of the builder

**What.** A platform that lists other people's applications pays for every listing to be
assessed. One customer, many applications, and the mark ends up where buyers already are.

**Who pays.** The platform.

**What it needs.** A conversation with a platform, not code. The portfolio and the
multi-application plumbing already exist.

**What could go wrong.** The obvious one, and it is serious: when a platform pays for all
of it, the platform becomes the customer whose applications we assess, and "can this
customer influence the result" stops being a question about a small payment and becomes a
question about the whole relationship. It would need the independence policy extended
before the first conversation, not after it.

**Size.** No code. A lot of care.

---

## Ideas that fail, and why they are written down anyway

**Paying to be higher in the directory.** No. The ordering rule is published on the page
and the scoring code structurally cannot read who is paying. This is the one thing we
have that nobody else does.

**Paying to jump the queue.** No, and it is more tempting than it looks, because a queue
position is not a score. But a customer who paid for speed and got a bad result will say
they paid for a result, and they will be believed. The services page now says in as many
words that money cannot shorten a queue, and that sentence should stay true.

**A second, easier badge for applications that nearly passed.** No. A mark that means
"nearly" is a mark that means nothing, and the wordmark may not be extended in any case.

**Assessing an application without its owner's authorisation, to build the directory
faster.** No. Everything in the directory is first-party and consented, the runner
refuses a target without a verified authorisation record, and that refusal is most of
what makes us different from a scraper with opinions.

**Certifying compliance with anything.** No. We are not auditors, we have no standing,
and the word is forbidden in our own copy by a gate that runs on every build.
