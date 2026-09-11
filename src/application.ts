/**
 * The application context: what `SpringApplication.run(SpringbootEntry.class)`
 * assembles, minus the container that assembled it.
 *
 * Component scanning, `@Autowired` and `@Value` are replaced by explicit
 * construction in dependency order, which is the same graph the original wires
 * reflectively.
 */

import { join } from 'node:path';

import { APPLICATION_CONTEXT_HEADER, healthMappings } from './actuator';
import { ConfigChecker } from './config-checker';
import { DeviceRepository, DEFAULT_STORE_PATH } from './dao/device-repository';
import { Dispatcher, type Mapping } from './deps/mvc';
import { DeviceResource } from './devicemanagmeent/device-resource';
import type { Environment } from './environment';
import { corsHeaders } from './filters/spring-boot-cors-filter';
import { HttpListeners } from './http-listeners';
import { HueMulator } from './hue/hue-mulator';
import { getLogger } from './logger';
import { UPNP_DISCOVERY_PORT, UpnpListener } from './upnp/upnp-listener';
import { UpnpSettingsResource } from './upnp/upnp-settings-resource';

const log = getLogger('com.armzilla.ha.SpringbootEntry');

/** `src/main/resources/static`, served from the context root. */
export const STATIC_ROOT = join(__dirname, '..', 'resources', 'static');

export interface ApplicationOptions {
  /** Overrides `jdbc:h2:file:./store`; tests point it at a scratch file. */
  readonly storePath?: string;
  /** Overrides the hard-coded SSDP port 1900; tests point it somewhere free. */
  readonly discoveryPort?: number;
}

export class Application {
  private constructor(
    readonly repository: DeviceRepository,
    readonly listeners: HttpListeners,
    readonly upnpListener: UpnpListener,
    readonly ports: readonly number[],
  ) {}

  /** `SpringApplication.run` — refresh the context, then start the listeners. */
  static async run(environment: Environment, options: ApplicationOptions = {}): Promise<Application> {
    new ConfigChecker(environment).afterPropertiesSet();

    const portBase = environment.getRequiredInt('emulator.portbase');
    const portCount = environment.getRequiredInt('emulator.portcount');

    const repository = new DeviceRepository(options.storePath ?? DEFAULT_STORE_PATH);
    const deviceResource = new DeviceResource(repository);
    const hueMulator = new HueMulator(repository, portBase);
    const upnpSettingsResource = new UpnpSettingsResource();

    const mappings: Mapping[] = [
      ...deviceResource.mappings(),
      ...hueMulator.mappings(),
      ...upnpSettingsResource.mappings(),
      ...healthMappings(),
    ];

    const alwaysHeaders = { ...corsHeaders(), ...APPLICATION_CONTEXT_HEADER };
    const dispatcher = new Dispatcher({ mappings, staticRoot: STATIC_ROOT, alwaysHeaders });

    const listeners = new HttpListeners(portBase, portCount, dispatcher, alwaysHeaders);
    const ports = await listeners.start();
    log.info(`Tomcat started on port(s): ${ports.map((port) => `${String(port)} (http)`).join(' ')}`);

    // The listener closes the context on an unrecoverable socket error, which
    // is the `applicationContext.close()` the original calls on itself.
    let context: Application | null = null;
    const upnpListener = new UpnpListener(
      {
        upnpResponsePort: environment.getRequiredInt('upnp.response.port'),
        responseAddress: environment.getRequiredString('upnp.config.address'),
        portBase,
        portCount,
        disable: environment.getRequiredBoolean('upnp.disable'),
        discoveryPort: options.discoveryPort ?? UPNP_DISCOVERY_PORT,
      },
      () => {
        void context?.close();
      },
    );

    const application = new Application(repository, listeners, upnpListener, ports);
    context = application;

    await upnpListener.startListening();
    log.info('Started SpringbootEntry');
    return application;
  }

  /** `ConfigurableApplicationContext.close()`. */
  async close(): Promise<void> {
    this.upnpListener.stop();
    await this.listeners.stop();
  }
}
