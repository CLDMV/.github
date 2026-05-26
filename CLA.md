# CLDMV Contributor License Agreement (CLA) — v1.0

> ⚠️ This is a starting point and **must be reviewed by legal counsel** before being treated as binding. Adjust to fit CLDMV's actual legal needs. The CLA bot detects signatures against this exact text via the `agreement.cla_sha256` recorded in each signature.

## Acceptance

By submitting any contribution (code, documentation, configuration, or other material) via pull request to a CLDMV repository, you ("Contributor") agree to the terms below for that contribution and all subsequent contributions you make to any CLDMV repository, until this CLA's `major.minor` version is bumped.

## 1. Grant of license

You grant CLDMV and recipients of software distributed by CLDMV a perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contribution and any derivative works thereof, **under the license of the project to which the contribution is made**.

This phrasing means one CLA covers every CLDMV repository regardless of that repo's individual LICENSE file. The terms the contribution is distributed under are whatever LICENSE says at the time of contribution.

## 2. Patent grant

You grant CLDMV and recipients of software distributed by CLDMV a perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent license under your patent claims necessarily infringed by your contribution, to make, have made, use, offer to sell, sell, import, and otherwise transfer the contribution and combinations of the contribution with the project to which it was submitted. This patent license terminates with respect to anyone who initiates patent litigation against CLDMV or any contributor alleging that the contribution constitutes direct or contributory patent infringement.

## 3. Originality and authority

You represent that:

- Each contribution is your original creation, or you have sufficient rights to submit it under this CLA.
- If your employer has rights to intellectual property you create that includes the contribution, you have received permission from your employer to make the contribution on its behalf, or your employer has waived such rights for the contribution.
- Each contribution does not knowingly include any confidential information or any material that you do not have the right to submit.

## 4. No warranty

The contribution is provided "as is," without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.

## 5. Signing

To accept these terms, reply to the CLA bot's comment on your pull request with this exact text:

```
I have read and I agree to the CLA v1.0
```

The bot will record your acceptance as an immutable JSON file in CLDMV's internal `.cla-signatures` ledger repository. The record captures your GitHub identity (immutable user ID, login at signing time, account metadata), the PR and commits that triggered signing, a SHA-256 of this document at the time of signing, and a commit-pinned URL to the exact text you agreed to. That ledger entry is the durable legal artifact.

The bot's acknowledgment comment on your PR is your **receipt**: it contains a stable `signature_id` (a SHA-256 hash anchoring your full record), the CLA version, and the signing timestamp. Keep that comment for your records. The ledger repository itself is private — contributor metadata (commit-author emails and similar) is not aggregated into a public, searchable index — so the comment is the only contributor-facing copy of your receipt.

Your signature applies to every CLDMV repository for every future contribution you make, until this CLA's `major.minor` version is bumped. You do not need to sign separately per repository or per pull request.

## 6. Exemption for organization members

If you are an active member of the CLDMV GitHub organization at the time of your contribution, you are covered by your org-level relationship and do not need to sign this CLA. The bot detects org membership via `GET /orgs/CLDMV/members/{login}` and silently passes the status check.

## 7. Versioning

CLA versions are numbered `major.minor.patch`:

| Level | Triggers re-signing? | Examples |
|---|---|---|
| **Major** (`v1.0` → `v2.0`) | Yes | Fundamental terms change — scope of the license grant, jurisdiction, addition or removal of a patent clause. |
| **Minor** (`v1.0` → `v1.1`) | Yes | Wording changes that affect meaning, clarification that shifts interpretation, added or removed exemption. |
| **Patch** (`v1.0` → `v1.0.1`) | **No** | Spelling fixes, typo corrections, pure formatting. No change in meaning. |

The bot reads the CLA version at `major.minor` granularity — patch-level fixes never invalidate an existing signature. Each signature record additionally captures the SHA-256 of the text at signing time and a commit-pinned URL to the exact version the contributor agreed to, so any earlier signature can be verified against precisely the text the contributor saw.

For the authoritative policy (workflow for patch fixes vs. minor/major bumps), see [VERSIONING.md](https://github.com/CLDMV/.cla-signatures/blob/master/VERSIONING.md) in the signatures ledger.
