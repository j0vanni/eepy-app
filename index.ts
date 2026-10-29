// Background tasks must be defined at module scope before the app starts (also in headless runs).
import './src/background/task';
import './src/notifications/learningResponses';
import 'expo-router/entry';
