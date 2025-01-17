import { LiveChannelScope, LiveChannelSupport, SelectableValue } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { config } from 'app/core/config';
import { loadPlugin } from 'app/features/plugins/PluginPage';
import { LiveMeasurementsSupport } from '../measurements/measurementsSupport';
import { CoreGrafanaLiveFeature } from './types';

export abstract class GrafanaLiveScope {
  constructor(protected scope: LiveChannelScope) {}

  /**
   * Load the real namespaces
   */
  abstract getChannelSupport(namespace: string): Promise<LiveChannelSupport | undefined>;

  /**
   * List the possible values within this scope
   */
  abstract listNamespaces(): Promise<Array<SelectableValue<string>>>;
}

class GrafanaLiveCoreScope extends GrafanaLiveScope {
  readonly features = new Map<string, LiveChannelSupport>();
  readonly namespaces: Array<SelectableValue<string>> = [];

  constructor() {
    super(LiveChannelScope.Grafana);
  }

  register(feature: CoreGrafanaLiveFeature) {
    this.features.set(feature.name, feature.support);
    this.namespaces.push({
      value: feature.name,
      label: feature.name,
      description: feature.description,
    });
  }

  /**
   * Load the real namespaces
   */
  async getChannelSupport(namespace: string) {
    const v = this.features.get(namespace);
    if (v) {
      return Promise.resolve(v);
    }
    throw new Error('unknown feature: ' + namespace);
  }

  /**
   * List the possible values within this scope
   */
  listNamespaces() {
    return Promise.resolve(this.namespaces);
  }
}
export const grafanaLiveCoreFeatures = new GrafanaLiveCoreScope();

export class GrafanaLiveDataSourceScope extends GrafanaLiveScope {
  names?: Array<SelectableValue<string>>;

  constructor() {
    super(LiveChannelScope.DataSource);
  }

  /**
   * Load the real namespaces
   */
  async getChannelSupport(namespace: string) {
    const ds = await getDataSourceSrv().get(namespace);
    if (ds.channelSupport) {
      return ds.channelSupport;
    }
    return new LiveMeasurementsSupport(); // default support?
  }

  /**
   * List the possible values within this scope
   */
  async listNamespaces() {
    if (this.names) {
      return Promise.resolve(this.names);
    }

    const names: Array<SelectableValue<string>> = [];

    for (const [key, ds] of Object.entries(config.datasources)) {
      if (ds.meta.live) {
        try {
          const s = await this.getChannelSupport(key); // ds.name or ID?
          if (s) {
            names.push({
              label: ds.name,
              value: ds.type,
              description: ds.type,
            });
          }
        } catch (err) {
          err.isHandled = true;
        }
      }
    }

    return (this.names = names);
  }
}

export class GrafanaLivePluginScope extends GrafanaLiveScope {
  names?: Array<SelectableValue<string>>;

  constructor() {
    super(LiveChannelScope.Plugin);
  }

  /**
   * Load the real namespaces
   */
  async getChannelSupport(namespace: string) {
    const plugin = await loadPlugin(namespace);
    if (!plugin) {
      throw new Error('Unknown streaming plugin: ' + namespace);
    }
    if (plugin.channelSupport) {
      return plugin.channelSupport; // explicit
    }
    throw new Error('Plugin does not support streaming: ' + namespace);
  }

  /**
   * List the possible values within this scope
   */
  async listNamespaces() {
    if (this.names) {
      return Promise.resolve(this.names);
    }
    const names: Array<SelectableValue<string>> = [];
    // TODO add list to config
    for (const [key, panel] of Object.entries(config.panels)) {
      if (panel.live) {
        try {
          const s = await this.getChannelSupport(key); // ds.name or ID?
          if (s) {
            names.push({
              label: panel.name,
              value: key,
              description: panel.info?.description,
            });
          }
        } catch (err) {
          err.isHandled = true;
        }
      }
    }
    return (this.names = names);
  }
}

export class GrafanaLiveStreamScope extends GrafanaLiveScope {
  names?: Array<SelectableValue<string>>;

  constructor() {
    super(LiveChannelScope.Stream);
  }

  async getChannelSupport(namespace: string) {
    return new LiveMeasurementsSupport();
  }

  /**
   * List the possible values within this scope
   */
  async listNamespaces() {
    if (this.names) {
      return Promise.resolve(this.names);
    }
    const names: Array<SelectableValue<string>> = [];

    // TODO!!!

    return (this.names = names);
  }
}
