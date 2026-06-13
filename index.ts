import type { ComponentType } from "react";
import moduleConfig from "./modules.config.json";
import * as HeatMap from "./HeatMap";
import * as Website from "./Website";

export type ModuleEntry = {
  component: ComponentType<{ config: Record<string, unknown> }>;
  config: {
    i: string;
    title: Record<string, string>;
    info: {
      dataSource: Record<string, string>;
      refreshFrequency: Record<string, string>;
      refreshAgeMinutes: number;
    };
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
  };
};

const avaliableModules: Record<string, ModuleEntry> = {
  HeatMap: { component: HeatMap.default, config: HeatMap.config },
  Website: { component: Website.default, config: Website.config },
};

const modules: Record<string, ModuleEntry> = Object.fromEntries(
  Object.entries(avaliableModules).filter(([key]) => moduleConfig[key as keyof typeof moduleConfig]?.enabled !== false),
);

export default modules;
