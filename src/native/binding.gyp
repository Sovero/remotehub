{
  "targets": [
    {
      "target_name": "rdp_com_host",
      "sources": ["rdp-com-addon.cpp"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "libraries": ["user32.lib", "ole32.lib", "oleaut32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": "1",
          "AdditionalOptions": ["/std:c++17"]
        }
      }
    }
  ]
}