export const MARIADB_VERSION = '10.6.23';  // bundled by Local — patched at startup
export const GITHUB_REPO = 'jpollock/local-addon-mariadb';

export interface ServiceVersion {
    version: string;
    /** True = Local bundles this version; use patch approach. False = create from scratch. */
    bundled: boolean;
}

export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },  // EOL upstream 2026-07-06
    { version: '10.11.11', bundled: false },
    { version: '11.8.8',   bundled: false },
];
