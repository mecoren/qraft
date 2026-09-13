import { describe, it, expect } from 'vitest';
import { parseImageMetadata, reportToText, type ImageMetadataReport } from './image-metadata-utils';

/** base64 → Uint8Array 测试辅助 */
function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// —— Pillow 真实生成的夹具(2026-09-13 一次性固化),真值见 plans/2026-09-13-image-metadata.md ——

/** Pillow RGBA8 300x200 + dpi=(72,72):IHDR/pHYs/IDAT/IEND */
const PNG_FIXTURE =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAADICAYAAABS39xVAAAACXBIWXMAAAsTAAALEwEAmpwYAAACrklEQVR4nO3UsQ3AIADAMMrIm/1f6gfwAlsVyb4gU571fnsABMy/AwBuGRaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYwKg4GbUD7Hii7JgAAAAASUVORK5CYII=';

/** Pillow 640x480 + 完整 EXIF(MM 端序,RATIONAL 写作 LONG 对):相机字段真值见下 */
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QCwRXhpZgAATU0AKgAAAAgACQEPAAIAAAAJAAAAegEQAAIAAAAHAAAAhAESAAMAAAABAAYAAAEyAAIAAAAUAAAAjIKaAAQAAAACAAAAoIKdAAMAAAACABwACognAAMAAAABAMgAAJAAAAcAAAAEMDIzMZIKAAMAAAACE4gD6AAAAABRcmFmdENhbQAAUVItMTAwAAAyMDI2OjA5OjEzIDEwOjAwOjAwAAA1Z+AAAAPo/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgB4AKAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A8Eooor+sz9ICiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==';

/** 手构标准 EXIF(II 端序 + RATIONAL type=5 + ExifSubIFD)JPEG 骨架:SOF0 800x600,JFIF 96 dots/cm */
const JPEG_STD_EXIF =
  '/9j/4AASSkZJRgABAgIAYABgAAAAAP/hAOhFeGlmAABJSSoACAAAAAUADwECAAgAAACkAAAAEAECAAgAAACsAAAAEgEDAAEAAAABAAAAMgECABQAAAC0AAAAaYcEAAEAAABKAAAAAAAAAAcAmoIFAAEAAADIAAAAnYIFAAEAAADQAAAAJ4gDAAEAAACQAQAACpIFAAEAAADYAAAAAJAHAAQAAAAwMjMyAqADAAEAAAAABAAAA6ADAAEAAAAAAwAAAAAAAFNURC1DYW0AU1RELTIwMAAyMDI2OjA5OjEzIDA4OjMwOjAwAAEAAAD6AAAALQAAAAoAAABgCQAA6AMAAP/AABEIAlgDIAMBIgACIgEDIgH/2Q==';

/** Pillow WebP lossy q80 320x200(VP8) */
const WEBP_LOSSY =
  'UklGRrwAAABXRUJQVlA4ILAAAAAwEQCdASpAAcgAPm02mUmkIyKhICgAgA2JaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D3pAAD+/3gv/8GyRTcj//+fmf/wP/7p7gAAAAAAAAAAAA==';

/** Pillow WebP lossless 320x200(VP8L) */
const WEBP_LOSSLESS = 'UklGRiQAAABXRUJQVlA4TBgAAAAvP8ExAAdQ0HpUq/8BAEX6/58i+p/6/2c=';

/** Pillow GIF 320x200(静态,GCT 4 色) */
const GIF_STATIC =
  'R0lGODdhQAHIAIEAAB6gWgAAAAAAAAAAACwAAAAAQAHIAEAI/wABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK17MuLHjx5AjS55MubLly5gza97MubPnz6BDix5NurTp06hTq17NurXr17Bjy55Nu7bt27hz697Nu7fv38CDCx9OvLjx48iTK1/OvLnz59CjS59Ovbr169iza9/Ovbv37+DDi6MfT768+fPo06tfz769+/fw48ufT7++/fv48+vfz7+///8ABijggAQWaOCBCCao4IIMNujggxBGKOGEFFZo4YUYZqjhhhx26OGHIIYo4ogklmjiiSimqOKKLLbo4oswxijjjDTWaOONOOao44489ujjj0AGKeSQRBZp5JFIJqnkkkw26eSTUEYp5ZRUVmnllVhmqeWWXHbp5ZdghinmmGSWGVZAADs=';

/** Pillow 3 帧动画 GIF 32x16 */
const GIF_MULTI =
  'R0lGODlhIAAQAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAIAAQAAAIJwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjxADAgAh+QQBCgABACwAAAAAIAAQAIEA/wAAAAAAAAAAAAAIJwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjxADAgAh+QQBCgABACwAAAAAIAAQAIEAAP8AAAAAAAAAAAAIJwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjxADAgA7';

/** Pillow 带文本 chunk 的 PNG 64x48(tEXt Title + iTXt Description zh-CN) */
const PNG_TEXT =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAE3RFWHRUaXRsZQBxcmFmdCBpbWdtZXRhf1tgNAAAACppVFh0RGVzY3JpcHRpb24AAAB6aC1DTgAA5Zu+54mH5YWD5pWw5o2u5rWL6K+VNMShvQAAAGlJREFUeJzVzjERACAQwLDSERH4l4IsRPzANQqy9j2USZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzESZzE+Tsw9QDalAFQBGtcngAAAABJRU5ErkJggg==';

// 手构 BMP:BITMAPINFOHEADER 40B,24bpp,2x1 自底向上(最小体积可断言)
function buildBmp(): Uint8Array {
  const b = new Uint8Array(54 + 8);
  const v = new DataView(b.buffer);
  b[0] = 0x42;
  b[1] = 0x4d; // 'BM'
  v.setUint32(2, 62, true); // 文件大小
  v.setUint32(10, 54, true); // 像素数据偏移
  v.setUint32(14, 40, true); // DIB 头大小
  v.setInt32(18, 2, true); // 宽
  v.setInt32(22, 1, true); // 高(正 = 自底向上)
  v.setUint16(26, 1, true); // planes
  v.setUint16(28, 24, true); // bpp
  v.setUint32(30, 0, true); // BI_RGB
  v.setUint32(34, 8, true); // 图像大小
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  return b;
}

describe('parseImageMetadata - PNG', () => {
  it('IHDR/pHYs:尺寸/位深/颜色类型/DPI/chunk 表', () => {
    const r = parseImageMetadata(b64(PNG_FIXTURE));
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('png');
    expect(r.formatLabel).toBe('PNG');
    expect(r.width).toBe(300);
    expect(r.height).toBe(200);
    expect(r.bitDepth).toBe(8);
    expect(r.colorInfo).toContain('RGBA');
    expect(r.interlaced).toBe(false);
    expect(r.transparency).toBe(true);
    expect(r.dpi).toBe(72);
    expect(r.pngChunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
  });

  it('tEXt/iTXt 文本条目解析', () => {
    const r = parseImageMetadata(b64(PNG_TEXT));
    expect(r.textEntries).toHaveLength(2);
    const t = r.textEntries[0]!;
    expect(t.keyword).toBe('Title');
    expect(t.text).toBe('qraft imgmeta');
    const i = r.textEntries[1]!;
    expect(i.keyword).toBe('Description');
    expect(i.text).toBe('图片元数据测试');
    expect(i.language).toBe('zh-CN');
  });

  it('截断 PNG 返回错误报告而非抛异常', () => {
    const full = b64(PNG_FIXTURE);
    // 截 44 字节:IHDR(8..29)完整、pHYs 头(33..41)完整但数据(len 9)越界
    const r = parseImageMetadata(full.subarray(0, 44));
    expect(r.error).toBeTruthy();
  });
});

describe('parseImageMetadata - JPEG', () => {
  it('Pillow 夹具:尺寸/分量数/EXIF 相机字段(MM 端序)', () => {
    const r = parseImageMetadata(b64(JPEG_B64));
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('jpeg');
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
    expect(r.colorInfo).toContain('3');
    const byName = new Map(r.exif.map((e) => [e.name, e.value]));
    expect(byName.get('Make')).toBe('QraftCam');
    expect(byName.get('Model')).toBe('QR-100');
    expect(byName.get('Orientation')).toContain('6');
    expect(byName.get('DateTime')).toBe('2026:09:13 10:00:00');
    // Pillow 宽容项:RATIONAL 写作 LONG 对,同样按 num/den 渲染
    expect(byName.get('ExposureTime')).toBe('3500000/1000');
    expect(byName.get('FNumber')).toBe('28/10');
    expect(byName.get('ISOSpeedRatings')).toBe('200');
    expect(byName.get('FocalLength')).toBe('5000/1000');
    expect(byName.get('ExifVersion')).toBe('0231');
  });

  it('标准 EXIF 夹具:II 端序 + SubIFD RATIONAL + JFIF 密度', () => {
    const r = parseImageMetadata(b64(JPEG_STD_EXIF));
    expect(r.error).toBeUndefined();
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    expect(r.dpi).toBe(244); // 96 dots/cm → 243.8 → 四舍五入
    const byName = new Map(r.exif.map((e) => [e.name, e.value]));
    expect(byName.get('Make')).toBe('STD-Cam');
    expect(byName.get('ExposureTime')).toBe('1/250');
    expect(byName.get('FNumber')).toBe('45/10');
    expect(byName.get('ISOSpeedRatings')).toBe('400');
    expect(byName.get('FocalLength')).toBe('2400/1000');
    expect(byName.get('PixelXDimension')).toBe('1024');
    expect(byName.get('PixelYDimension')).toBe('768');
  });

  it('无 EXIF 的 JPEG(纯 SOF 骨架)不产生 exif 条目', () => {
    // SOI + SOF0(2x2,3 分量)+ EOI 手构:SOF 数据 = 精度(1) + h(2) + w(2) + 分量数(1)
    // + 3×(id, sampling, quant)(9) = 15 字节,段长 = 2 + 15 = 17
    const b = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xc0,
      0x00,
      0x11, // SOF0, len=17
      8,
      0x00,
      0x02,
      0x00,
      0x02, // 精度 8, h=2, w=2
      0x03, // 3 分量
      0x01,
      0x22,
      0x00,
      0x02,
      0x22,
      0x01,
      0x03,
      0x22,
      0x01, // 分量表
      0xff,
      0xd9, // EOI
    ]);
    const r = parseImageMetadata(b);
    expect(r.error).toBeUndefined();
    expect(r.width).toBe(2);
    expect(r.height).toBe(2);
    expect(r.exif).toHaveLength(0);
  });
});

describe('parseImageMetadata - WebP', () => {
  it('VP8 有损:尺寸(经验布局 bits0-13 / bits16-29)', () => {
    const r = parseImageMetadata(b64(WEBP_LOSSY));
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('webp');
    expect(r.formatLabel).toBe('WebP');
    expect(r.width).toBe(320);
    expect(r.height).toBe(200);
  });

  it('VP8L 无损:尺寸(sig 0x2F + LE32 w14|h14|alpha|version)', () => {
    const r = parseImageMetadata(b64(WEBP_LOSSLESS));
    expect(r.error).toBeUndefined();
    expect(r.width).toBe(320);
    expect(r.height).toBe(200);
    expect(r.transparency).toBe(false);
  });
});

describe('parseImageMetadata - GIF', () => {
  it('静态 GIF:尺寸/GCT 背景色/帧数 1', () => {
    const r = parseImageMetadata(b64(GIF_STATIC));
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('gif');
    expect(r.formatLabel).toBe('GIF');
    expect(r.width).toBe(320);
    expect(r.height).toBe(200);
    expect(r.frameCount).toBe(1);
    expect(r.animate).toBe(false);
    expect(r.backgroundColor).toBe('#1ea05a');
  });

  it('动画 GIF:帧数 3 + animate', () => {
    const r = parseImageMetadata(b64(GIF_MULTI));
    expect(r.error).toBeUndefined();
    expect(r.width).toBe(32);
    expect(r.height).toBe(16);
    expect(r.frameCount).toBe(3);
    expect(r.animate).toBe(true);
  });
});

describe('parseImageMetadata - BMP', () => {
  it('BITMAPINFOHEADER:尺寸/bpp/压缩/文件大小', () => {
    const r = parseImageMetadata(buildBmp());
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('bmp');
    expect(r.formatLabel).toBe('BMP');
    expect(r.width).toBe(2);
    expect(r.height).toBe(1);
    expect(r.bitDepth).toBe(24);
    expect(r.colorInfo).toContain('BI_RGB');
    expect(r.colorInfo).toContain('自底向上');
  });
});

describe('parseImageMetadata - 未知格式', () => {
  it('非图片字节返回错误报告', () => {
    const r = parseImageMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(r.error).toBeTruthy();
    expect(r.format).toBe('unknown');
    expect(r.formatLabel).toBe('-');
  });

  it('空输入返回错误报告', () => {
    const r = parseImageMetadata(new Uint8Array(0));
    expect(r.error).toBeTruthy();
  });
});

describe('reportToText', () => {
  it('纯文本报告含核心字段与本地化标签', () => {
    const r: ImageMetadataReport = parseImageMetadata(b64(PNG_FIXTURE));
    const text = reportToText(
      { ...r, fileName: 'a.png', fileSize: 764 },
      {
        file: '文件',
        exif: 'EXIF',
        text: '文本',
        chunks: 'Chunk 清单',
        fields: {
          fileName: '名称',
          fileSize: '大小',
          format: '格式',
          dimensions: '尺寸',
          bitDepth: '位深',
          color: '颜色',
          dpi: 'DPI',
          interlaced: '交错',
          transparency: '透明',
          frames: '帧数',
          background: '背景色',
          error: '错误',
        },
      },
      (k, v) => `${k}: ${v}`,
    );
    expect(text).toContain('名称: a.png');
    expect(text).toContain('尺寸: 300 × 200');
    expect(text).toContain('位深: 8');
    expect(text).toContain('透明: true');
    expect(text).toContain('Chunk 清单:');
    expect(text).toContain('IHDR: 13 B');
  });
});
