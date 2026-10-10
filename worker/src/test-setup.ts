// Git hooks export these variables. Fixture repos must use their own Git state.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES']) {
  delete process.env[key];
}
