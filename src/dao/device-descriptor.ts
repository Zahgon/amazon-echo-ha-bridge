/** The persisted entity — table `devices`, primary key `id`. */

export class DeviceDescriptor {
  id: string | null = null;
  name: string | null = null;
  deviceType: string | null = null;
  offUrl: string | null = null;
  onUrl: string | null = null;
  httpVerb: string | null = null;
  contentType: string | null = null;
  contentBody: string | null = null;

  /** Jackson emits the getters in field-declaration order, nulls included. */
  toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      deviceType: this.deviceType,
      offUrl: this.offUrl,
      onUrl: this.onUrl,
      httpVerb: this.httpVerb,
      contentType: this.contentType,
      contentBody: this.contentBody,
    };
  }

  static fromJson(source: Record<string, unknown>): DeviceDescriptor {
    const descriptor = new DeviceDescriptor();
    descriptor.id = (source['id'] as string | null | undefined) ?? null;
    descriptor.name = (source['name'] as string | null | undefined) ?? null;
    descriptor.deviceType = (source['deviceType'] as string | null | undefined) ?? null;
    descriptor.offUrl = (source['offUrl'] as string | null | undefined) ?? null;
    descriptor.onUrl = (source['onUrl'] as string | null | undefined) ?? null;
    descriptor.httpVerb = (source['httpVerb'] as string | null | undefined) ?? null;
    descriptor.contentType = (source['contentType'] as string | null | undefined) ?? null;
    descriptor.contentBody = (source['contentBody'] as string | null | undefined) ?? null;
    return descriptor;
  }
}
