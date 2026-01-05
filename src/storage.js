import Conf from 'conf';

const store = new Conf({
  projectName: 'gitaudit',
  schema: {
    githubToken: {
      type: 'string',
    },
    githubUser: {
      type: 'object',
      properties: {
        login: { type: 'string' },
        name: { type: 'string' },
        id: { type: 'number' },
      },
    },
  },
});

export function saveToken(token) {
  store.set('githubToken', token);
}

export function getToken() {
  return store.get('githubToken');
}

export function saveUser(user) {
  store.set('githubUser', user);
}

export function getUser() {
  return store.get('githubUser');
}

export function clearAuth() {
  store.delete('githubToken');
  store.delete('githubUser');
}

export function isAuthenticated() {
  return !!getToken();
}
