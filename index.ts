import type { ComponentType } from "react";
import moduleConfig from "./modules.config.json" with { type: "json" };
import * as Website from "./Website";
import * as Note from "./Note";
import * as Weather from "./Weather";
import * as Chat from "./Chat";
import * as Code from "./Code";
import * as Calendar from "./Calendar";
import * as Clock from "./Clock";
import * as Map from "./Map";
import * as Image from "./Image";

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
  Website: { component: Website.default, config: Website.config },
  Note: { component: Note.default, config: Note.config },
  Weather: { component: Weather.default, config: Weather.config },
  Chat: { component: Chat.default, config: Chat.config },
  Code: { component: Code.default, config: Code.config },
  Calendar: { component: Calendar.default, config: Calendar.config },
  Clock: { component: Clock.default, config: Clock.config },
  Map: { component: Map.default, config: Map.config },
  Image: { component: Image.default, config: Image.config },
};

const modules: Record<string, ModuleEntry> = Object.fromEntries(
  Object.entries(avaliableModules).filter(([key]) => moduleConfig[key as keyof typeof moduleConfig]?.enabled !== false),
);

export default modules;
