# What's new in S.P.R.U.C.E+

<!-- For the maintainer (not shown on GitHub's page): one entry per release to the stores, newest
     first, covering everything since the previous store version, in plain words: what a user notices,
     no file names, settings keys or internal terms. The full, technical history is CHANGELOG.md.
     Where each entry goes (docs/DEVELOPMENT.md, "Publishing"):
       - Firefox (addons.mozilla.org): the version's "Release notes" box;
       - Safari (App Store): "What's New in This Version" (at most 4,000 characters);
       - Chrome Web Store and Edge Add-ons have no such box: the description ends with a link here. -->

Short notes on each version in the browser stores. Every detail is in the
[full changelog](../CHANGELOG.md).

## 5.95

Changes since 5.91.

**Stronger against phishing**
- On sites where anyone can have their own page (such as github.io, pages.dev or blogspot.com), each page
  now counts as its own site: a link whose text shows one person's page but leads to someone else's is
  pointed out, and a company's name used there isn't taken for the company's.
- QR codes and links inside Word documents (.docx) attached to an email are now checked on your device,
  like those in PDFs and pictures (Gmail).
- An email that fails its sender's verification is no longer excused just because it was passed through a
  forwarding service; only forwarding by Google or by your own organization still counts.

**Fewer false alarms**
- A legal notice about a company, such as a class-action settlement administrator writing about an
  Amazon settlement, is no longer marked dangerous or moved to Spam because its sender's name mentions
  the company. It gets a caution instead, since fake settlement notices exist too.

**The Link Inspector explains why a link may be dangerous**
- It shows what each security service says about a site and how many of them agree. When only one
  flags it, it says this may be a false alarm and which service to tell.
- It lists the warning signs in the link itself, such as a fake brand name, a hidden address, a file
  that runs programs or a free page-building service, with what each one means.
- It offers free second opinions (VirusTotal, urlscan.io, Google Safe Browsing, Sucuri) in one click,
  and with your own free VirusTotal key, VirusTotal's results right in the Inspector.

**More links decoded**
- iContact email-marketing links now show where they really go, and so do older SendGrid links.
- Newer SendGrid links can't be read by anyone but SendGrid. The Link Inspector can now follow such a
  link for you (without your cookies, and without opening the page) to show where it goes; it tells you
  first that the sender will count it as a click.
- Invisible "email opened" trackers pasted into the Inspector are explained: they lead nowhere.

**More reliable:** a slow server no longer interrupts the extension's list updates in Chrome and Edge.

## 5.91

Changes since 5.90.

**For organizations**
- Settings → Help → Deploying in organizations explains how to install S.P.R.U.C.E+ for everyone from
  the Chrome Web Store, Microsoft Edge Add-ons or Firefox Add-ons, with each store's extension ID, instead
  of how to publish a copy of your own.

## 5.90

Changes since 5.75, the previous version in the stores.

**Fewer false alarms**
- Links to a company's own other sites are no longer marked dangerous: American Express's go.amex,
  Google's blog.google, Bank of America's bofa.com and many more.
- In Gmail, a link in an email verified as really coming from that company is marked for caution at
  most, never as dangerous, and the email isn't moved to Spam for it.
- Genuine mail from a company's second address (such as Amazon Music's amazonmusic.com) is checked
  against public records before it's treated as fake.
- An image sized in percent is no longer mistaken for a tracking pixel.

**Stronger against impostors**
- A site that only borrows a company's name with another ending (such as paypal.*something*) is no
  longer trusted for its name alone.
- A specially made link can no longer pass itself off as leading to a trustworthy site, and an impostor
  can't pass as a brand by using the same DNS provider.

**Moving scams to Spam (Gmail)**
- Flagged emails leave the inbox sooner: once your mouse rests for a moment (still 10 seconds after a
  click or key, so it never gets in the way of an Undo).
- An email about to move is crossed out and can't be clicked by accident; **Move now** and **Keep it**
  let you decide. The toolbar button shows how many are waiting, and why.
- Senders you trust are never shown as flagged, and a move Gmail didn't carry out is no longer
  reported as done.

**Settings, Help and logs**
- With several accounts signed in, every log says which account it's about; taking an email back out
  of Spam updates its log line instead of adding a second one.
- Site icons fill their circles, company logos no longer go missing after a slow answer, and drop-down
  menus are readable in the dark appearance.
- "Offline only" reuses what was already checked instead of starting over.
- Help lists every list the extension downloads, with its license. New: once a month, ICANN's public
  list of internet endings, to recognize a company's own endings such as .amex (nothing about you is
  sent).
- Clearer wording: S.P.R.U.C.E+ points out warning signs; it can miss dangerous emails and flag genuine
  ones. A Donate button in Help → About.

**Firefox**
- Messages in Proton Mail, iCloud, Zoho and GMX are checked in Firefox versions before 148 too, and
  "Check installed extensions" works.
- When the browser doesn't allow the extension on a webmail site, the toolbar button says so, with a
  button to allow it (also in Chrome and Edge).
- Firefox and Safari now get every improvement at the same time as Chrome and Edge.

**For organizations**
- Phishing-training rules that name the training company's sending servers now work.
- Every administrator policy is documented, and Help shows this installation's own extension ID.

**Faster:** an open email's notice no longer redraws itself constantly, searching the logs is smoother,
and the lists update once a day as intended.
