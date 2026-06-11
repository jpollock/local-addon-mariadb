# MariaDB for Local

A [Local by Flywheel](https://localwp.com) addon that adds **MariaDB 10.6.23** as a database option when creating WordPress sites.

## Platform Support

| Platform | Status |
|----------|--------|
| macOS Apple Silicon (arm64) | ✅ Supported |
| macOS Intel (x86_64) | 🔄 Coming soon |
| Linux (x86_64) | ✅ Supported |
| Windows | ❌ Not supported (Local's built-in MariaDB handles Windows) |

## Requirements

- [Local](https://localwp.com) 9.0.0 or later
- Internet connection (binaries downloaded on first use, ~25 MB)
- macOS or Linux (see platform table above)

## Installation

### For Development

```bash
git clone https://github.com/jpollock/local-addon-mariadb.git
cd local-addon-mariadb
npm install
npm run build
npm run install-addon   # Creates symlink in Local's addons directory
```

Restart Local after running `install-addon`.

### Verifying Installation

After restarting Local, check the logs for:
```
[local-addon-mariadb] Patched bundled service and linked bin/
```

## Using MariaDB

1. In Local, click **+** to create a new site
2. Choose a site name and click **Continue**
3. On the environment step, click **Custom**
4. In the **Database** dropdown, select **MariaDB 10.6.23**
5. Complete site creation

On first use, Local will automatically download the MariaDB binaries (~25 MB) in the background. If the download is slow, site creation may take an extra moment.

## How to Verify MariaDB Is Running

After creating a site, go to **wp-admin → Tools → Site Health → Info → Database**. You should see:

```
Server version: 10.6.23-MariaDB
```

## Known Limitations

- **macOS Intel:** Binary build is in progress. Intel Mac users cannot use this addon yet.
- **Binary signing:** Binaries are ad-hoc signed (sufficient for Local to run them). They cannot be run directly from Terminal without additional trust steps.
- **No MySQL→MariaDB migration:** Switching an existing MySQL site to MariaDB requires manually exporting and re-importing the database.

## Troubleshooting

**MariaDB doesn't appear in the database dropdown**
- Confirm the addon is enabled in Local (check Add-ons panel)
- Restart Local and check logs for `[local-addon-mariadb]` entries
- Ensure `~/Library/Application Support/Local/addons/local-addon-mariadb` (macOS) or `~/.config/Local/addons/local-addon-mariadb` (Linux) is a valid symlink

**Site fails to create / provisioning error**
- Check Local logs for `bootstrapDatadir` or `[local-addon-mariadb]`
- Verify the binaries downloaded: check for `bin/darwin-arm64/bin/mysqld` in the addon directory
- If download failed, delete the `bin/` directory and restart Local to retry

**Binary download fails**
- Check your internet connection
- Verify the [GitHub Release](https://github.com/jpollock/local-addon-mariadb/releases/tag/v10.6.23) is accessible
- Corporate firewalls may block GitHub Releases — download manually and extract to `bin/darwin-arm64/`

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → lib/
npm test             # Run unit tests
npm run install-addon  # Symlink into Local's addons dir
```

After making code changes: `npm run build`, then restart Local.

## Contributing

Bug reports and pull requests welcome at [github.com/jpollock/local-addon-mariadb](https://github.com/jpollock/local-addon-mariadb).
