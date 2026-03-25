declare module "node-webpmux" {
  const WebPMux: {
    Image: new () => {
      load(input: Buffer): Promise<void>;
      save(path?: string | null): Promise<Buffer>;
      exif?: Buffer;
    };
  };

  export default WebPMux;
}
