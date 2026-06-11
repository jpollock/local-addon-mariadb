import * as LocalMain from '@getflywheel/local/main';
import path from 'path';
import slash from 'slash';
import fs from 'fs-extra';
import delay from 'delay';
import { MARIADB_VERSION } from './constants';

export default class MariadbService extends LocalMain.LightningService {
    serviceName = 'mariadb';
    binVersion = MARIADB_VERSION;

    get configTemplatePath(): string {
        return path.join(__dirname, '../conf');
    }

    get $PATHs(): Record<string, string> {
        return {
            [LocalMain.LightningServicePlatform.Darwin]:      path.join(__dirname, '../bin/darwin/bin'),
            [LocalMain.LightningServicePlatform.DarwinArm64]: path.join(__dirname, '../bin/darwin-arm64/bin'),
            [LocalMain.LightningServicePlatform.Linux]:       path.join(__dirname, '../bin/linux/bin'),
            [LocalMain.LightningServicePlatform.Win32]:       path.join(__dirname, '../bin/win32/bin'),
        };
    }

    /** Parent of bin/, lib/, share/ — required by mysql_install_db --basedir on macOS/Linux */
    getBasedir(platform: string): string {
        return path.join(__dirname, '..', 'bin', platform);
    }

    get bins(): Record<string, Record<string, string>> {
        const unix = (platform: string) => ({
            mysql:            path.join(this.$PATHs[platform], 'mysql'),
            mysqld:           path.join(this.$PATHs[platform], 'mysqld'),
            mysqladmin:       path.join(this.$PATHs[platform], 'mysqladmin'),
            mysqldump:        path.join(this.$PATHs[platform], 'mysqldump'),
            mysqlcheck:       path.join(this.$PATHs[platform], 'mysqlcheck'),
            mysql_install_db: path.join(this.$PATHs[platform], 'mysql_install_db'),
        });
        const win32 = (platform: string) => ({
            mysql:            path.join(this.$PATHs[platform], 'mysql.exe'),
            mysqld:           path.join(this.$PATHs[platform], 'mysqld.exe'),
            mysqladmin:       path.join(this.$PATHs[platform], 'mysqladmin.exe'),
            mysqldump:        path.join(this.$PATHs[platform], 'mysqldump.exe'),
            mysqlcheck:       path.join(this.$PATHs[platform], 'mysqlcheck.exe'),
            mysql_install_db: path.join(this.$PATHs[platform], 'mysql_install_db.exe'),
        });
        return {
            [LocalMain.LightningServicePlatform.Darwin]:      unix(LocalMain.LightningServicePlatform.Darwin),
            [LocalMain.LightningServicePlatform.DarwinArm64]: unix(LocalMain.LightningServicePlatform.DarwinArm64),
            [LocalMain.LightningServicePlatform.Linux]:       unix(LocalMain.LightningServicePlatform.Linux),
            [LocalMain.LightningServicePlatform.Win32]:       win32(LocalMain.LightningServicePlatform.Win32),
        };
    }

    get requiredPorts(): Record<string, number> {
        return { MYSQL: 1 };
    }

    get socket(): string {
        return path.join(this.runPath, 'mysqld.sock');
    }

    get dataPath(): string {
        return slash(path.join(this.runPath, 'data'));
    }

    async preprovision(): Promise<void> {
        await this.setupMysqlDatadir();
    }

    async provision(): Promise<void> {
        await this.setupMysqlUser();
        await this.setupDatabase();
    }

    private currentPlatform(): string {
        if (process.platform === 'darwin' && process.arch === 'arm64') {
            return LocalMain.LightningServicePlatform.DarwinArm64;
        }
        if (process.platform === 'darwin') return LocalMain.LightningServicePlatform.Darwin;
        if (process.platform === 'linux') return LocalMain.LightningServicePlatform.Linux;
        return LocalMain.LightningServicePlatform.Win32;
    }

    private async setupMysqlDatadir(): Promise<void> {
        this._logger.info('Initializing MariaDB datadir...', { dataPath: this.dataPath });
        await fs.ensureDir(this.dataPath);

        if (process.platform === 'win32') {
            // Windows: mysql_install_db.exe handles quoting correctly
            await LocalMain.execFilePromise(this.bin?.mysql_install_db!, [
                `--datadir=${this.dataPath}`,
                `--port=${this.port}`,
                `--socket=${this.socket}`,
                `--password=root`,
                `--default-user=root`,
            ]);
        } else {
            // macOS/Linux: mysql_install_db shell script cannot handle spaces in paths
            // (Local's userDataPath always contains "Application Support"). Use mysqld
            // --bootstrap with the SQL init files directly — equivalent to mysql_install_db.
            await this.bootstrapDatadir();
        }
    }

    private async bootstrapDatadir(): Promise<void> {
        const platform = this.currentPlatform();
        const shareDir = path.join(this.getBasedir(platform), 'share');

        const systemTables = fs.readFileSync(path.join(shareDir, 'mysql_system_tables.sql'), 'utf8');
        const systemData = fs.readFileSync(path.join(shareDir, 'mysql_system_tables_data.sql'), 'utf8');

        // Set root password via global_priv (MariaDB 10.4+ auth storage)
        const bootstrapSQL = [
            'CREATE DATABASE IF NOT EXISTS mysql;',
            'USE mysql;',
            systemTables,
            'USE mysql;',
            systemData,
            `UPDATE mysql.global_priv SET priv=json_set(priv,'$.plugin','mysql_native_password','$.authentication_string',PASSWORD('root')) WHERE user='root' AND host='localhost';`,
            'FLUSH PRIVILEGES;',
        ].join('\n');

        const { execFilePromise } = LocalMain as any;

        // Pipe SQL into mysqld --bootstrap — no shell, no space-in-path issues
        await new Promise<void>((resolve, reject) => {
            const child = require('child_process').spawn(
                this.bin?.mysqld!,
                [
                    '--no-defaults',
                    '--bootstrap',
                    `--datadir=${this.dataPath}`,
                    `--basedir=${this.getBasedir(platform)}`,
                    `--socket=/tmp/mariadb-bootstrap-${process.pid}.sock`,
                ],
                { stdio: ['pipe', 'ignore', 'pipe'] }
            );
            child.stdin.write(bootstrapSQL);
            child.stdin.end();

            let stderr = '';
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

            child.on('close', (code: number) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`MariaDB bootstrap failed (exit ${code}):\n${stderr.slice(-500)}`));
                }
            });
            child.on('error', reject);
        });
    }

    private async setupMysqlUser(): Promise<void> {
        this._logger.info('Setting up MariaDB user...');
        await this.waitForDB(true);
        try {
            await LocalMain.execFilePromise(this.bin?.mysql!, [
                '--password=',
                '-e',
                `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root';`,
            ], { env: { MYSQL_HOME: this.configPath } });
        } catch (e: any) {
            this._logger.error('Error setting up MariaDB user', { stack: e.stack });
        }
    }

    private async waitForDB(noPassword = false): Promise<boolean> {
        let latestError: Error | undefined;
        const maxTries = 5;
        const baseDelay = 1000;
        const maxDelay = 10000;

        for (let i = 0; i < maxTries; i++) {
            try {
                await LocalMain.execFilePromise(this.bin?.mysqladmin!, [
                    ...(noPassword ? ['--password='] : []),
                    'ping',
                ], { env: { MYSQL_HOME: this.configPath } });
                this._logger.debug('Database responded to ping.');
                return true;
            } catch (e: any) {
                const delayMs = Math.min(maxDelay, baseDelay * Math.pow(2, i));
                this._logger.info(`Database connection attempt ${i + 1} failed. Retrying in ${delayMs} ms.`);
                await delay(delayMs);
                latestError = e;
            }
        }
        this._logger.error(`Database did NOT respond to ping after ${maxTries} tries.`, { stack: latestError?.stack });
        throw latestError;
    }

    private async setupDatabase(): Promise<void> {
        this._logger.info('Creating MariaDB database...');
        try {
            await LocalMain.execFilePromise(this.bin?.mysql!, [
                '-e', 'CREATE DATABASE local;',
            ], { env: { MYSQL_HOME: this.configPath } });
        } catch (e: any) {
            this._logger.error('Error creating database.', { stack: e.stack });
            throw e;
        }
    }

    get configVariables(): Record<string, string | number> {
        return {
            datadir:       this.dataPath,
            port:          this.port ?? 3306,
            socket:        this.socket.replace('\\', '\\\\'),
            clientAddress: '127.0.0.1',
            bindAddress:   '127.0.0.1',
        };
    }

    start(): any[] {
        fs.ensureDirSync(this.runPath);
        return [{
            name:    'mariadb',
            binPath: this.bin?.mysqld,
            args:    [`--defaults-file=${slash(path.join(this.configPath, 'my.cnf'))}`],
        }];
    }
}
