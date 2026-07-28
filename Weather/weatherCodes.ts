export type Lang = "en" | "ja" | "zh";

export type WeatherIcon = "clear" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "storm";

type WeatherCodeInfo = { icon: WeatherIcon; label: Record<Lang, string> };

// https://open-meteo.com/en/docs — WMO weather interpretation codes
export const WEATHER_CODES: Record<number, WeatherCodeInfo> = {
  0: { icon: "clear", label: { en: "Clear sky", ja: "快晴", zh: "晴朗" } },
  1: { icon: "clear", label: { en: "Mainly clear", ja: "ほぼ快晴", zh: "大部晴朗" } },
  2: { icon: "partly-cloudy", label: { en: "Partly cloudy", ja: "一部曇り", zh: "多云" } },
  3: { icon: "cloudy", label: { en: "Overcast", ja: "曇り", zh: "阴天" } },
  45: { icon: "fog", label: { en: "Fog", ja: "霧", zh: "雾" } },
  48: { icon: "fog", label: { en: "Rime fog", ja: "霧氷を伴う霧", zh: "雾凇" } },
  51: { icon: "rain", label: { en: "Light drizzle", ja: "弱い霧雨", zh: "小毛毛雨" } },
  53: { icon: "rain", label: { en: "Drizzle", ja: "霧雨", zh: "毛毛雨" } },
  55: { icon: "rain", label: { en: "Dense drizzle", ja: "強い霧雨", zh: "大毛毛雨" } },
  56: { icon: "rain", label: { en: "Freezing drizzle", ja: "着氷性の霧雨", zh: "冻毛毛雨" } },
  57: { icon: "rain", label: { en: "Dense freezing drizzle", ja: "強い着氷性の霧雨", zh: "强冻毛毛雨" } },
  61: { icon: "rain", label: { en: "Light rain", ja: "弱い雨", zh: "小雨" } },
  63: { icon: "rain", label: { en: "Rain", ja: "雨", zh: "中雨" } },
  65: { icon: "rain", label: { en: "Heavy rain", ja: "強い雨", zh: "大雨" } },
  66: { icon: "rain", label: { en: "Freezing rain", ja: "着氷性の雨", zh: "冻雨" } },
  67: { icon: "rain", label: { en: "Heavy freezing rain", ja: "強い着氷性の雨", zh: "强冻雨" } },
  71: { icon: "snow", label: { en: "Light snow", ja: "弱い雪", zh: "小雪" } },
  73: { icon: "snow", label: { en: "Snow", ja: "雪", zh: "中雪" } },
  75: { icon: "snow", label: { en: "Heavy snow", ja: "強い雪", zh: "大雪" } },
  77: { icon: "snow", label: { en: "Snow grains", ja: "霧雪", zh: "米雪" } },
  80: { icon: "rain", label: { en: "Light showers", ja: "弱いにわか雨", zh: "小阵雨" } },
  81: { icon: "rain", label: { en: "Showers", ja: "にわか雨", zh: "阵雨" } },
  82: { icon: "rain", label: { en: "Violent showers", ja: "激しいにわか雨", zh: "强阵雨" } },
  85: { icon: "snow", label: { en: "Light snow showers", ja: "弱い雪のにわか降り", zh: "小阵雪" } },
  86: { icon: "snow", label: { en: "Heavy snow showers", ja: "強い雪のにわか降り", zh: "大阵雪" } },
  95: { icon: "storm", label: { en: "Thunderstorm", ja: "雷雨", zh: "雷暴" } },
  96: { icon: "storm", label: { en: "Thunderstorm with hail", ja: "雹を伴う雷雨", zh: "雷暴伴冰雹" } },
  99: { icon: "storm", label: { en: "Severe thunderstorm with hail", ja: "激しい雹を伴う雷雨", zh: "强雷暴伴冰雹" } },
};

const UNKNOWN: WeatherCodeInfo = { icon: "cloudy", label: { en: "Unknown", ja: "不明", zh: "未知" } };

export function describeWeatherCode(code: number): WeatherCodeInfo {
  return WEATHER_CODES[code] ?? UNKNOWN;
}
