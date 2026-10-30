<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="branding/logo-dark-background.png">
  <img src="branding/logo.png" alt="S.P.R.U.C.E+ — Spam &amp; Phishing Risk URL Checker Extension+" width="640">
</picture></p>

# S.P.R.U.C.E+

**Spam & Phishing Risk URL Checker Extension+**: a browser extension that helps you spot phishing and
scam emails in Gmail and other webmail.

<p><a href="https://www.paypal.com/donate/?hosted_button_id=NA8SK5RBLWGW6"><img src="https://img.shields.io/badge/Donate-PayPal-0070ba?logo=paypal&amp;logoColor=white" alt="Donate with PayPal"></a></p>

> **A helper, not a guarantee.** S.P.R.U.C.E+ makes a best effort to point out warning signs, but it
> can miss dangerous emails and links, and it can flag genuine ones. It is one small layer of
> protection: keep your webmail's own spam filtering, your organization's email security, your
> browser's protections and your own judgment. When in doubt, don't click: contact the sender
> another way.

## At a glance

- **Where links really go:** short links and security-gateway wrappers are expanded, and links whose
  text shows one site but lead to another are pointed out.
- **Warning signs in your inbox, before you open anything:** fake brand names, look-alike addresses,
  known scam senders, senders using your own name, "call this number" scams.
- **A warning in the opened email,** with dangerous links marked in red.
- **QR codes and attachments** checked on your device.
- **Likely scams moved to Spam** (Gmail), with your webmail's own Report spam.
- **Tracking pixels** removed.
- **Private by design:** no account, no ads, no analytics. Every check has its own switch.

Every feature in detail, and which webmail supports what: [docs/FEATURES.md](docs/FEATURES.md).

## Install

Once it is published, install it from addons.mozilla.org (desktop Firefox). To try a test version from this repository, follow
[docs/INSTALL-FOR-TESTERS.md](docs/INSTALL-FOR-TESTERS.md).

## Documentation

| | |
|---|---|
| [Features](docs/FEATURES.md) | Everything the extension does, and which webmail supports what |
| [Admin guide](docs/ADMIN-GUIDE.md) | Deploying it with Firefox policy; **every** policy key, including the administrator-only ones |
| [Privacy policy](PRIVACY.md) | What is read on your device, what can leave it, and to whom |
| [Architecture](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/blob/main/docs/ARCHITECTURE.md) | How it works inside, with diagrams (written for the Chrome build; the engine is the same) |
| [Development](docs/DEVELOPMENT.md) | Building, testing and publishing; repository layout |
| [Tester install](docs/INSTALL-FOR-TESTERS.md) | Installing a test version |
| [Changelog](CHANGELOG.md) | Every version, what changed and why |

The extension's own **Help** tab (Settings → Help) explains every warning, the privacy details and
troubleshooting.

## Support the project

S.P.R.U.C.E+ is free, with no ads and no tracking. If you find it useful, you can support its
development with a donation:
[**Donate with PayPal**](https://www.paypal.com/donate/?hosted_button_id=NA8SK5RBLWGW6), or scan the code below.

<img src="branding/donate-qr.png" alt="QR code for the PayPal donation page" width="128" height="128">

## License

[Apache License 2.0](LICENSE). Bundled third-party components keep their own licenses
(`lib/PDFJS-LICENSE`, credits in the extension's Help → About).
