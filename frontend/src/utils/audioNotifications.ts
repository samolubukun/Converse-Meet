// Audio Notification Utility using Web Audio API

class AudioNotificationManager {
  private audioContext: AudioContext | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = true;
    } catch (error) {
      console.warn("AudioContext not supported:", error);
    }
  }

  async playTone(frequencies: number | [number, number][], duration = 0.3, volume = 0.3): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (!this.audioContext) return;

    try {
      // Resume if suspended (browser security policy)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.type = "sine";

      if (Array.isArray(frequencies)) {
        for (const [freq, time] of frequencies) {
          const startTime = this.audioContext.currentTime + time;
          oscillator.frequency.setValueAtTime(freq, startTime);
        }
      } else {
        oscillator.frequency.setValueAtTime(frequencies, this.audioContext.currentTime);
      }

      // Attack & decay to prevent clicking sounds
      const attackTime = 0.01;
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + attackTime);
      gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime + attackTime);
      gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration);

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch (error) {
      console.warn("Failed to play notification tone:", error);
    }
  }

  async playJoinNotification(): Promise<void> {
    await this.playTone(
      [
        [262, 0],    // C4
        [392, 0.08], // G4
        [659, 0.16], // E5
        [523, 0.24], // C5
      ],
      0.5,
      0.08
    );
  }

  async playLeaveNotification(): Promise<void> {
    await this.playTone(
      [
        [392, 0],   // G4
        [330, 0.1], // E4
        [262, 0.2], // C4
      ],
      0.4,
      0.08
    );
  }

  async playJoinRequestNotification(): Promise<void> {
    await this.playTone(
      [
        [349, 0],   // F4
        [440, 0.1], // A4
        [349, 0.2], // F4
        [523, 0.3], // C5
      ],
      0.6,
      0.15
    );
  }

  async playChatNotification(): Promise<void> {
    await this.playTone(
      [
        [330, 0],   // E4
        [392, 0.1], // G4
      ],
      0.25,
      0.12
    );
  }

  async playRaiseHandNotification(): Promise<void> {
    await this.playTone(
      [
        [523.25, 0],    // C5
        [659.25, 0.08], // E5
        [783.99, 0.16], // G5
      ],
      0.5,
      0.12
    );
  }
}

export const audioNotificationManager = new AudioNotificationManager();
