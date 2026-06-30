import type { ComponentType } from "react";
import moduleConfig from "./modules.config.json" with { type: "json" };
import * as HeatMap from "./HeatMap";
import * as Website from "./Website";
import * as Note from "./Note";

export type ModuleEntry = {
  component: ComponentType<{ config: Record<string, unknown> }>;
  config: {
    i: string;
    title: Record<string, string>;
    info: Array<{
      title: Record<string, string>;
      items: Array<{
        key: Record<string, string>;
        value: Record<string, string>;
      }>;
    }>;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    comp?: Record<string, unknown>;
  };
};

const avaliableModules: Record<string, ModuleEntry> = {
  HeatMap: { component: HeatMap.default, config: HeatMap.config },
  Website: { component: Website.default, config: Website.config },
  Note: { component: Note.default, config: Note.config },
};

const modules: Record<string, ModuleEntry> = Object.fromEntries(
  Object.entries(avaliableModules).filter(([key]) => moduleConfig[key as keyof typeof moduleConfig]?.enabled !== false),
);

export default modules;
