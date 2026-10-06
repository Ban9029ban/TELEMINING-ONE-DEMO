#pragma once

#include <stdint.h>

using FrameSrc = uint8_t;

// Mantener el payload comun en 260 bytes para sender/receiver.
struct FrameItem {
  FrameSrc src;
  uint16_t len;
  char data[260];
  uint8_t retries;
};
