import { EventEmitter } from 'node:events';
import type { LiveEvent } from '../../../shared/types';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(event: LiveEvent) {
  bus.emit('event', event);
}

export function subscribe(listener: (event: LiveEvent) => void) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
