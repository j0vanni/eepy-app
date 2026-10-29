// Native modules that tests reach indirectly (the persisted store) get their official mocks.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
