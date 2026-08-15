export const config = {
  i: "Clock",
  title: { en: "Clock", ja: "時計", zh: "时钟" },
  refreshAgeMinutes: 0,
  info: [
    {
      title: { en: "Settings", ja: "設定", zh: "设置" },
      items: [
        {
          key: { en: "Time zone", ja: "タイムゾーン", zh: "时区" },
          value: {
            en: "Set comp.timeZone to an IANA zone such as Asia/Tokyo; leave empty for local time",
            ja: "comp.timeZone に Asia/Tokyo などのIANAゾーンを設定。空欄はローカル時刻",
            zh: "将 comp.timeZone 设为 Asia/Tokyo 等 IANA 时区；留空使用本地时间",
          },
        },
        {
          key: { en: "Display", ja: "表示", zh: "显示" },
          value: {
            en: "comp.hour12 changes 12/24-hour time; comp.showSeconds shows the second hand",
            ja: "comp.hour12 で12/24時間表示、comp.showSeconds で秒針を切り替え",
            zh: "comp.hour12 切换12/24小时制；comp.showSeconds 显示秒针",
          },
        },
      ],
    },
  ],
  x: 0,
  y: 0,
  w: 14,
  h: 19,
  minW: 11,
  minH: 15,
  comp: {
    timeZone: "Asia/Tokyo",
    hour12: false,
    showSeconds: true,
  },
};
