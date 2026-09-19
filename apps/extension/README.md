# VibefyCode badge check

A small browser extension that answers one question: does the site I am looking
at carry a live VibefyCode badge?

## What it does not do

It does not watch what you browse. It cannot: there is no content script, no
background page reading tab URLs, and no request to our servers about any
individual site.

That is why the icon does not light up by itself. An extension that lights up
on its own has to look at every page you open, and an extension that asks a
server "does this site have a badge" has sent that server your browsing history
one request at a time, whatever its store listing promises. Neither is worth
being slightly more convenient than a bookmark.

Instead: the list of every live badge is downloaded whole, once an hour, in one
request that is the same whatever you are doing. When you click the icon, the
answer is worked out from the copy already on your computer.

## What it holds

One object in `chrome.storage.local`: the list, and when it was generated. It is
overwritten on each refresh and it is never sent anywhere. There is no
analytics, no identifier and no account.

## Permissions, and why each one is there

| Permission                        | Why                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `storage`                         | To keep the downloaded list.                                                                   |
| `alarms`                          | To refresh it once an hour rather than on every click.                                         |
| `activeTab`                       | To read the address of the tab you are on **at the moment you click the icon**, and only then. |
| `https://verify.vibefycode.app/*` | To download the list. The only host it can reach.                                              |

`activeTab` is the narrow one on purpose. It grants nothing until you click, and
nothing about any other tab, ever.

## Running it before it is in a store

1. Open `chrome://extensions`, turn on developer mode.
2. Choose **Load unpacked** and select this folder.
3. Click the icon on any site.

Publishing it to the Chrome Web Store and to Firefox Add-ons needs a developer
account in the company's name, which is one of the open items waiting on the
legal entity. The code is ready; the listings are not something code can do.

## What a grey answer does not mean

That the site has no badge. A badge holder can ask not to appear in any public
listing while staying certified, and the list this extension downloads honours
that — so "not in the list" covers both "never asked for a badge" and "has one
and asked not to be listed". The extension says so rather than guessing, because
the guess would be a claim about somebody's application that we cannot support.

## What a green answer means

That a badge was issued for this exact origin and is live today. It does not
mean the application is without defects, and the verification page it links to
says what the assessment covered and what it did not. A badge issued for
`https://kettle.example` does not cover `https://shop.kettle.example`: a mark
earned by one application must not end up vouching for another.
