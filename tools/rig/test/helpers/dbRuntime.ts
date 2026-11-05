/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Headless harness around the **real** DragonBones JS runtime that ships inside Cocos Creator 3.8.8
 * (`engine/node_modules/@cocos/dragonbones-js`): the same parser + animation/IK code `ArmatureDisplay` uses, with a
 * no-op display layer. Used to validate exporter output (parse + pose). Skipped when the editor is not installed
 * (CI has no Cocos); set COCOS_CREATOR_PATH to the CocosCreator executable to enable locally.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_EXE = 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe';

export function engineRuntimePath(): string | null {
  const exe = process.env.COCOS_CREATOR_PATH ?? DEFAULT_EXE;
  const p = join(dirname(exe), 'resources/resources/3d/engine/node_modules/@cocos/dragonbones-js/out/dragonBones.js');
  return existsSync(p) ? p : null;
}

export interface Runtime {
  readonly db: any;
  /** Parse ske+tex and return a function building an armature by name. */
  load(ske: unknown, tex: unknown): LoadedData;
}

export interface LoadedData {
  dataName: string;
  armatures: string[];
  data: any;
  /** Build an armature and register it on the factory clock so `advance` drives it and flushes its events. */
  build(name: string): any;
  /** Advance the shared clock (seconds); frame events are collected into `events`. */
  advance(seconds: number): void;
  readonly events: { type: string; name: string; time: number }[];
}

let cached: Promise<Runtime> | null = null;

export function loadRuntime(): Promise<Runtime> {
  cached ??= createRuntime();
  return cached;
}

async function createRuntime(): Promise<Runtime> {
  const path = engineRuntimePath();
  if (!path) throw new Error('Cocos DragonBones runtime not found');
  const db: any = await import(pathToFileURL(path).href);

  class StubSlot extends db.Slot {
    static toString() {
      return '[class StubSlot]';
    }
    _onClear() {
      super._onClear();
    }
    _initDisplay() {}
    _disposeDisplay() {}
    _onUpdateDisplay() {
      this._display = this._rawDisplay;
    }
    _addDisplay() {}
    _replaceDisplay() {}
    _removeDisplay() {}
    _updateZOrder() {}
    _updateVisible() {}
    _updateBlendMode() {}
    _updateColor() {}
    _updateFrame() {}
    _updateMesh() {}
    _updateGlueMesh() {}
    _updateTransform() {}
    _identityTransform() {}
  }
  class StubTextureData extends db.TextureData {
    static toString() {
      return '[class StubTextureData]';
    }
  }
  class StubAtlasData extends db.TextureAtlasData {
    static toString() {
      return '[class StubAtlasData]';
    }
    createTexture() {
      return db.BaseObject.borrowObject(StubTextureData);
    }
  }
  const proxy = (sink?: any[]): any => ({
    dbInit() {},
    dbClear() {},
    dbUpdate() {},
    dispose() {},
    hasDBEventListener: () => true,
    addDBEventListener() {},
    removeDBEventListener() {},
    dispatchDBEvent(type: string, e: any) {
      sink?.push({ type, name: e.name, time: e.time });
    },
    armature: null,
    animation: null,
  });
  class StubFactory extends db.BaseFactory {
    constructor() {
      super();
      this.events = [];
      this._dragonBones = new db.DragonBones({
        hasDBEventListener: () => true,
        dispatchDBEvent: (type: string, e: any) => {
          this.events.push({ type, name: e.name, time: e.time });
        },
      });
    }
    _buildTextureAtlasData(textureAtlasData: any) {
      return textureAtlasData ?? db.BaseObject.borrowObject(StubAtlasData);
    }
    _buildArmature(dataPackage: any) {
      const armature = db.BaseObject.borrowObject(db.Armature);
      armature.init(dataPackage.armature, proxy(this.events), {}, this._dragonBones);
      return armature;
    }
    _buildSlot(_dp: any, slotData: any, armature: any) {
      const slot = db.BaseObject.borrowObject(StubSlot);
      slot.init(slotData, armature, {}, {});
      return slot;
    }
  }

  return {
    db,
    load(ske, tex) {
      const factory = new StubFactory();
      const data = factory.parseDragonBonesData(JSON.parse(JSON.stringify(ske)));
      if (!data) throw new Error('DragonBones runtime rejected the ske data');
      const atlas = factory.parseTextureAtlasData(JSON.parse(JSON.stringify(tex)), {});
      if (!atlas) throw new Error('DragonBones runtime rejected the tex data');
      return {
        dataName: data.name,
        armatures: data.armatureNames as string[],
        data,
        events: factory.events,
        build: (name: string) => {
          const armature = factory.buildArmature(name, data.name);
          factory._dragonBones.clock.add(armature);
          return armature;
        },
        advance: (seconds: number) => factory._dragonBones.advanceTime(seconds),
      };
    },
  };
}
