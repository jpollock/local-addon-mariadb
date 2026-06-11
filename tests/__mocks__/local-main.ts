export enum LightningServicePlatform {
    Darwin = 'darwin',
    DarwinArm64 = 'darwin-arm64',
    Linux = 'linux',
    Win32 = 'win32',
    Win32x64 = 'win64',
}

export class LightningService {
    _logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    runPath = '/tmp/run/site123/mariadb';
    configPath = '/tmp/run/site123/conf/mariadb';
    port = 10053;
    bin: Record<string, string> = {
        mysql:            '/usr/local/bin/mysql',
        mysqld:           '/usr/local/bin/mysqld',
        mysqladmin:       '/usr/local/bin/mysqladmin',
        mysqldump:        '/usr/local/bin/mysqldump',
        mysqlcheck:       '/usr/local/bin/mysqlcheck',
        mysql_install_db: '/usr/local/bin/mysql_install_db',
    };
}

export const execFilePromise = jest.fn().mockResolvedValue(undefined);
export const registerLightningService = jest.fn();
