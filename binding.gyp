{
  'targets': [{
    'target_name': 'tiny_http',
    'include_dirs': [
      '<!(node -e "require(\'napi-macros\')")',
    ],
    'sources': [
      './binding.c',
    ],
    'conditions': [
      ['OS=="win"', {
        'libraries': [
          '-lws2_32',
        ]
      }],
    ],
    'xcode_settings': {
      'OTHER_CFLAGS': [
        '-O3',
      ]
    },
    'cflags': [
      '-O3',
    ],
  }]
}
