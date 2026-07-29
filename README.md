
liveboard-mod-basic
===================


Basic [Liveboard](https://github.com/lhypds/liveboard) module.


Setup
-----

`board.config.json`  
Setup the repo URL.  

`modules.config.json`  
Modules config file, enable or disable modules, etc.  


modules.config.json
-------------------

Modules config file.  
key is the `ModuleName`, same as folder name.  


config.ts
---------

`config.ts` is in each module folder,  
It controls module default config template.  

Field `comp` is settings only used for that module.  
Fileds other than `comp` are common configs.  
