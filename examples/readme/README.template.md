# {{package}}

<!-- OPTIONAL: centered banner. Delete the block if the repo has no banner image. -->
<div align="center">
	<img src="https://github.com/CLDMV/{{repo}}/raw/HEAD/images/{{repo}}-banner.jpg" alt="{{repo}} Logo">
</div>

**{{package}}** {{description}}

{{intro}}

> _{{tagline}}_

[![npm version]][npm_version_url] [![npm downloads]][npm_downloads_url] <!-- [![GitHub release]][github_release_url] -->[![GitHub downloads]][github_downloads_url] [![Last commit]][last_commit_url] <!-- [![Release date]][release_date_url] -->[![npm last update]][npm_last_update_url] [![coverage]][coverage_url]

<!-- OPTIONAL: status callout. Delete when there is nothing to flag. -->

> [!NOTE]
> **{{status_title}}**
>
> - {{status_point}}

[![Contributors]][contributors_url] [![Sponsor shinrai]][sponsor_url]

---

## ✨ What's New

### Latest: v{{latest_version}} ({{latest_month_year}})

- {{latest_bullet_1}}
- {{latest_bullet_2}}
- [View full v{{latest_version}} Changelog](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/changelog/v{{latest_major}}/v{{latest_version}}.md)

### Recent Releases

<!-- Exactly four bullets, newest first. On each release the previous Latest becomes the top bullet and the oldest bullet is dropped. -->

- **v{{recent_1_version}}** ({{recent_1_month_year}}) — {{recent_1_summary}} ([Changelog](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/changelog/v{{recent_1_major}}/v{{recent_1_version}}.md))
- **v{{recent_2_version}}** ({{recent_2_month_year}}) — {{recent_2_summary}} ([Changelog](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/changelog/v{{recent_2_major}}/v{{recent_2_version}}.md))
- **v{{recent_3_version}}** ({{recent_3_month_year}}) — {{recent_3_summary}} ([Changelog](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/changelog/v{{recent_3_major}}/v{{recent_3_version}}.md))
- **v{{recent_4_version}}** ({{recent_4_month_year}}) — {{recent_4_summary}} ([Changelog](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/changelog/v{{recent_4_major}}/v{{recent_4_version}}.md))

📚 **For complete version history and detailed release notes, see [docs/changelog/](https://github.com/CLDMV/{{repo}}/tree/{{default_branch}}/docs/changelog/) folder.**

---

## 🚀 Key Features

- **{{feature_1_title}}**: {{feature_1_text}}
- **{{feature_2_title}}**: {{feature_2_text}}
- **{{feature_3_title}}**: {{feature_3_text}}

---

## 📦 Installation

### Requirements

- **Node.js v{{node_min}} or higher**

### Install

```bash
npm install {{package}}
```

---

## 🚀 Quick Start

```javascript
import {{import_name}} from "{{package}}";

{{quick_start_esm}}
```

CommonJS works the same way: `const {{import_name}} = require("{{package}}")`.

---

## 📚 Configuration

<!-- CLI and API tools: use `## 💻 CLI` and/or `## 🔧 API` here in place of the options table. -->

The most-used options are summarized below. The complete reference lives in **[docs/CONFIGURATION.md](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/CONFIGURATION.md)**.

| Option         | Type                | Default                | Description              |
| -------------- | ------------------- | ---------------------- | ------------------------ |
| `{{option_1}}` | `{{option_1_type}}` | `{{option_1_default}}` | {{option_1_description}} |

---

## 📚 Documentation

### Reference

- **[Configuration Reference](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/CONFIGURATION.md)** — {{configuration_blurb}}
- **[Changelog](https://github.com/CLDMV/{{repo}}/tree/{{default_branch}}/docs/changelog/)** — all release notes

### Guides

- **[{{guide_title}}](https://github.com/CLDMV/{{repo}}/blob/{{default_branch}}/docs/{{guide_file}})** — {{guide_blurb}}

### Repo

- **[Contributing](./CONTRIBUTING.md)** — contribution guidelines
- **[Security Policy](./SECURITY.md)** — security guidelines and reporting

[![CodeFactor]][codefactor_url] [![OpenSSF Scorecard]][ossf_scorecard_url] [![npms.io score]][npms_url] [![npm unpacked size]][npm_size_url] [![Repo size]][repo_size_url]

---

## 🤝 Contributing

We welcome contributions! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

[![Contributors]][contributors_url] [![Sponsor shinrai]][sponsor_url]

---

## 🔗 Links

- **npm**: [{{package}}](https://www.npmjs.com/package/{{package}})
- **GitHub**: [CLDMV/{{repo}}](https://github.com/CLDMV/{{repo}})
- **Issues**: [GitHub Issues](https://github.com/CLDMV/{{repo}}/issues)
- **Releases**: [GitHub Releases](https://github.com/CLDMV/{{repo}}/releases)

---

## 📄 License

[![GitHub license]][github_license_url] [![npm license]][npm_license_url]

{{license}} © Shinrai / CLDMV

<!-- [github release]: https://img.shields.io/github/v/release/CLDMV/{{repo}}?style=for-the-badge&logo=github&logoColor=white&labelColor=181717 -->
<!-- [github_release_url]: https://github.com/CLDMV/{{repo}}/releases -->

[npm version]: https://img.shields.io/npm/v/{{package_encoded}}.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_version_url]: https://www.npmjs.com/package/{{package}}
[last commit]: https://img.shields.io/github/last-commit/CLDMV/{{repo}}?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[last_commit_url]: https://github.com/CLDMV/{{repo}}/commits
[npm last update]: https://img.shields.io/npm/last-update/{{package_encoded}}?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_last_update_url]: https://www.npmjs.com/package/{{package}}
[codefactor]: https://img.shields.io/codefactor/grade/github/CLDMV/{{repo}}?style=for-the-badge&logo=codefactor&logoColor=white&labelColor=F44A6A
[codefactor_url]: https://www.codefactor.io/repository/github/cldmv/{{repo}}
[openssf scorecard]: https://img.shields.io/ossf-scorecard/github.com/CLDMV/{{repo}}?style=for-the-badge&label=OpenSSF%20Scorecard
[ossf_scorecard_url]: https://scorecard.dev/viewer/?uri=github.com/CLDMV/{{repo}}
[npms.io score]: https://img.shields.io/npms-io/final-score/{{package_encoded}}?style=for-the-badge&logo=npms&logoColor=white&labelColor=0B5D57
[npms_url]: https://npms.io/search?q={{package_encoded}}
[npm downloads]: https://img.shields.io/npm/dm/{{package_encoded}}.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_downloads_url]: https://www.npmjs.com/package/{{package}}
[github downloads]: https://img.shields.io/github/downloads/CLDMV/{{repo}}/total?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[github_downloads_url]: https://github.com/CLDMV/{{repo}}/releases
[npm unpacked size]: https://img.shields.io/npm/unpacked-size/{{package_encoded}}.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_size_url]: https://www.npmjs.com/package/{{package}}
[repo size]: https://img.shields.io/github/repo-size/CLDMV/{{repo}}?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[repo_size_url]: https://github.com/CLDMV/{{repo}}
[github license]: https://img.shields.io/github/license/CLDMV/{{repo}}.svg?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[github_license_url]: https://github.com/CLDMV/{{repo}}/blob/HEAD/LICENSE
[npm license]: https://img.shields.io/npm/l/{{package_encoded}}.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_license_url]: https://www.npmjs.com/package/{{package}}
[coverage]: https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FCLDMV%2F{{repo}}%2Fbadges%2Fcoverage.json&style=for-the-badge&logo=vitest&logoColor=white
[coverage_url]: https://github.com/CLDMV/{{repo}}/blob/badges/coverage.json
[contributors]: https://img.shields.io/github/contributors/CLDMV/{{repo}}.svg?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[contributors_url]: https://github.com/CLDMV/{{repo}}/graphs/contributors
[sponsor shinrai]: https://img.shields.io/github/sponsors/shinrai?style=for-the-badge&logo=githubsponsors&logoColor=white&labelColor=EA4AAA&label=Sponsor
[sponsor_url]: https://github.com/sponsors/shinrai
