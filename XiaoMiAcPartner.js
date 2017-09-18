var miio = require('miio');
var outputSignal = require("./packages/acSignal_handle");
var Accessory, Service, Characteristic;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-mi-acpartner', 'XiaoMiAcPartner', XiaoMiAcPartner);
}

function XiaoMiAcPartner(log, config) {
    if(null == config) {
        this.log.error('[XiaoMiAcPartner][ERROR] Cannot find config');
        return;
    }

    //Init
    var that = this;
    this.log = log;
    this.name = config.name || "AcPartner";
    this.token = config.token;
    this.ip = config.ip;
    this.LastHeatingCoolingState = this.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
    this.CurrentTemperature = 0;
    this.CurrentRelativeHumidity = 0;
    this.config = config;
    this.acModel = null;

    //Optional
    this.maxTemp = parseInt(config.maxTemp) || 30;
    this.minTemp = parseInt(config.minTemp) || 17;
    this.outerSensor = config.sensorSid;
    this.wiSync = config.sync;
    this.autoStart = config.autoStart;
    if (config.customize) {
        this.customi = config.customize;
        this.log.debug("[XiaoMiAcPartner][DEBUG] Using customized AC signal...");
    }else{
        this.data = JSON;
        this.data.defaultState = Characteristic.TargetHeatingCoolingState;
        this.log.debug("[XiaoMiAcPartner][DEBUG] Using presets...");
    }
    
    this.services = [];

    //Register as Thermostat
    this.acPartnerService = new Service.Thermostat(this.name);

      this.acPartnerService
          .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('set', this.setTargetHeatingCoolingState.bind(this))
        .on('get', this.getTargetHeatingCoolingState.bind(this));

    this.acPartnerService
        .getCharacteristic(Characteristic.TargetTemperature)
        .setProps({
            maxValue: that.maxTemp,
            minValue: that.minTemp,
            minStep: 1
        })
        .on('set', this.setTargetTemperature.bind(this))
        .on('get', this.getTargetTemperature.bind(this));

    this.acPartnerService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
            maxValue: 60,
            minValue: -20,
            minStep: 1
        })
        .on('get', this.getCurrentTemperature.bind(this));;

    this.acPartnerService
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .setProps({
            maxValue: 100,
            minValue: 0,
            minStep: 1
        })
        .on('get', this.getCurrentRelativeHumidity.bind(this));

    this.services.push(this.acPartnerService);

    this.serviceInfo = new Service.AccessoryInformation();

    this.serviceInfo
        .setCharacteristic(Characteristic.Manufacturer, 'XiaoMi')
        .setCharacteristic(Characteristic.Model, 'AC Partner');
    
    this.services.push(this.serviceInfo);

    this.discover();

    /*this.humSensorService = new Service.HumiditySensor("Hum_" + this.name);
    //if connected with temperature sensor, register new humSensor.
    if (this.outerSensor) {
        this.humSensorService = new Service.HumiditySensor("Hum_" + this.name);
    }*/

    this.doRestThing();

}

XiaoMiAcPartner.prototype = {
    doRestThing: function(){
        var that = this;

        setInterval(function() {
            //Rediscover Partner every 180s
            that.discover();
        }, 180000);

        if (!this.wiSync) {
            this.log.info("[XiaoMiAcPartner][INFO] Auto sync every 60 second");
            setInterval(function() {
                that.getACState();
            }, 60000);   
        }else{
            this.TargetTemperature = (this.maxTemp + this.minTemp) / 2;
            this.log.info("[XiaoMiAcPartner][INFO] Auto sync off");
        }
    },

    discover: function(){
        var accessory = this;
        var log = this.log;
        var token = this.token;
        this.log.debug('[XiaoMiAcPartner][DEBUG] Searching AC Partner...');
        // Discover device in the network

        miio.device({ address: this.ip, token: this.token })
            .then(function(device){
                accessory.device = device;
                accessory.log.debug('[XiaoMiAcPartner][DEBUG] Discovered "%s" (ID: %s) on %s:%s.', device.hostname, device.id, device.address, device.port);
                if (!accessory.wiSync) {
                    accessory.getACState();   
                }
            }).catch(function(err){
                accessory.log.error("[XiaoMiAcPartner][ERROR] Cannot connect to AC Partner." + err);
            })
    },

    getTargetHeatingCoolingState: function(callback) {
        callback(null, this.TargetHeatingCoolingState);
    },

    setTargetHeatingCoolingState: function(TargetHeatingCoolingState, callback, context) {
        if(context !== 'fromSetValue') {
            this.TargetHeatingCoolingState = TargetHeatingCoolingState;
            if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF) {
                this.log("[XiaoMiAcPartner][INFO] AC turned off");
            }
            
            this.SendCmd();
        }
        callback();
    },

    getTargetTemperature: function(callback) {
        callback(null, this.TargetTemperature);
    },

    setTargetTemperature: function(TargetTemperature, callback, context) {
        if(context !== 'fromSetValue') {
              this.TargetTemperature = TargetTemperature;
              if (!this.autoStart && this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF) {
                this.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.AUTO;
                this.acPartnerService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
                    .updateValue(this.TargetHeatingCoolingState);
              }

            if (!this.outerSensor) {
                // Update CurrentTemperature
                this.acPartnerService
                    .getCharacteristic(Characteristic.CurrentTemperature)
                    .updateValue(parseFloat(TargetTemperature));
            }

            this.log.debug('[XiaoMiAcPartner][DEBUG] Set TargetTemperature: ' + TargetTemperature);
            this.SendCmd();
        }

        callback();
    },

    getCurrentTemperature: function(callback) {
        if (!this.outerSensor) {
            this.log("[XiaoMiAcPartner][INFO] Set CurrentTemperature %s", this.TargetTemperature);
            callback(null, parseFloat(this.TargetTemperature));
        }else{
            callback(null, parseFloat(this.CurrentTemperature));
        }
    },

    getCurrentRelativeHumidity: function(callback){
        callback(null, parseFloat(this.CurrentRelativeHumidity));
    },

    identify: function(callback) {
        callback();
    },

    getServices: function() {
        return this.services;
    },

    onStart: function() {
        var code;
        var that = this;
        if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF && this.LastHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF) {
            return;
        }
        if (this.LastHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF && this.customi.on) {
            code = this.customi.on;
            if (code.substr(0,2) == "01") {
                this.log.debug("[XiaoMiAcPartner][DEBUG] AC on, sending AC code: " + code);
                this.device.call('send_cmd', [code])
                    .then(function(ret){
                        that.log.debug("[XiaoMiAcPartner][DEBUG] Return result: " + ret[0]);
                    }).catch(function(err){
                        that.log.error("[XiaoMiAcPartner][ERROR] Send code fail! Error: " + err);
                    });
            }else{
                this.log.debug("[XiaoMiAcPartner][DEBUG] AC on, sending IR code: " + code);
                this.device.call('send_ir_code', [code])
                    .then(function(ret){
                        that.log.debug("[XiaoMiAcPartner][DEBUG] Return result: " + ret[0]);
                    }).catch(function(err){
                        that.log.error("[XiaoMiAcPartner][ERROR] Send code fail! Error: " + err);
                    });
            }
        }
    },

    getCuSignal: function(){
        this.onStart();
        var code;
        if (this.TargetHeatingCoolingState != Characteristic.TargetHeatingCoolingState.OFF) {
            if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.HEAT) {
                if (!this.customi||!this.customi.heat||!this.customi.heat[this.TargetTemperature]) {
                    this.log.error('[XiaoMiAcPartner][WARN] HEAT Signal not define!');
                    return;
                }
                code = this.customi.heat[this.TargetTemperature];
            }else if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.COOL){
                if (!this.customi||!this.customi.cool||!this.customi.cool[this.TargetTemperature]) {
                    this.log.error('[XiaoMiAcPartner][WARN] COOL Signal not define!');
                    return;
                }
                code = this.customi.cool[this.TargetTemperature];
            }else{
                if (!this.customi||!this.customi.auto) {
                    this.log.error('[XiaoMiAcPartner][WARN] AUTO Signal not define! Will send COOL signal instead');
                    if (!this.customi||!this.customi.cool||!this.customi.cool[this.TargetTemperature]) {
                        this.log.error('[XiaoMiAcPartner][WARN] COOL Signal not define!');
                        return;
                    }
                    code = this.customi.cool[this.TargetTemperature];
                }else{
                    code = this.customi.auto;
                }
            }
        }else{
            if (!this.customi||!this.customi.off) {
                this.log.error('[XiaoMiAcPartner][WARN] OFF Signal not define!');
                return;
            }
            code = this.customi.off;
        }
        return code;
    },

    SendCmd: function() {
        if (!this.device) {
            this.log.error('[XiaoMiAcPartner][WARN] Send code failed!(Device not exists)');
            return;
        }

        var accessory = this;
        var code;
        this.log.debug("[XiaoMiAcPartner][DEBUG] Last TargetHeatingCoolingState: " + this.LastHeatingCoolingState);
        this.log.debug("[XiaoMiAcPartner][DEBUG] Current TargetHeatingCoolingState: " + this.TargetHeatingCoolingState);
        if (!this.customi) {
            this.data.model = this.acModel;
            this.data.TargetTemperature = this.TargetTemperature;
            this.data.TargetHeatingCoolingState = this.TargetHeatingCoolingState;
            this.data.LastHeatingCoolingState = this.LastHeatingCoolingState;
            var retCode = outputSignal(this.data);
            if (!retCode) {
                this.log.error('[XiaoMiAcPartner][WARN] Cannot get command code.')
                return;
            }
            //this.log.debug("[XiaoMiAcPartner][DEBUG] Get code: " + retCode.data);
            if (retCode.auto) {
                this.log('[XiaoMiAcPartner][INFO] You are using auto_gen code, if your AC don\'t response, please use customize method to control your AC.')
            }else{
                this.log.debug('[XiaoMiAcPartner][INFO] Using preset: %s',retCode.model);
            }
            code = retCode.data;
            delete retCode;

        }else{
            code = this.getCuSignal();
            if (!code) {
                return;
            }
        }
        
        if (code.substr(0,2) == "01") {
            this.log.debug("[XiaoMiAcPartner][DEBUG] Sending AC code: " + code);
            this.device.call('send_cmd', [code])
                .then(function(data){
                    if (data[0] == "ok") {
                        accessory.LastHeatingCoolingState = accessory.TargetHeatingCoolingState;
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG] Change Successful");
                    }else{
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG] Unsuccess! Maybe invaild AC Code?");
                        accessory.getACState();
                    }
                }).catch(function(err){
                    that.log.error("[XiaoMiAcPartner][ERROR] Send code fail! Error: " + err);
                });
        }else{
            this.log.debug("[XiaoMiAcPartner][DEBUG] Sending IR code: " + code);
            this.device.call('send_ir_code', [code])
                .then(function(data){
                    if (data[0] == "ok") {
                        accessory.LastHeatingCoolingState = accessory.TargetHeatingCoolingState;
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG] Send Successful");
                    }else{
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG] Unsuccess! Maybe invaild IR Code?");
                        accessory.getACState();
                    }
                }).catch(function(err){
                        accessory.log.error("[XiaoMiAcPartner][ERROR] Send IR code fail! " + err);
                });
        }
    },

    getACState: function(){
        if (!this.device) {
            this.log.error("[XiaoMiAcPartner][WARN] Sync failed!(Device not exists)");
            return;
        }

        var acc = this;
        this.log.debug("[XiaoMiAcPartner][INFO] Syncing...")

        //Update CurrentTemperature
        if(this.outerSensor){
            this.device.call('get_device_prop_exp', [[acc.outerSensor, "temperature", "humidity"]])
                .then(function(curTep){
                    if (curTep[0][0] == null) {
                        acc.log.error("[XiaoMiAcPartner][WARN] Invaild sensorSid!")
                    }else{
                        acc.log.debug("[XiaoMiAcPartner][INFO] Temperature Sensor return:%s",curTep[0]);
                        acc.CurrentTemperature = curTep[0][0] / 100.0;
                        acc.CurrentRelativeHumidity = curTep[0][1] / 100.0;
                        acc.acPartnerService.getCharacteristic(Characteristic.CurrentTemperature)
                            .updateValue(acc.CurrentTemperature);
                        acc.acPartnerService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .updateValue(acc.CurrentRelativeHumidity);
                    }
                })
        }

        //Update AC state
        this.device.call('get_model_and_state', [])
            .then(function(retMaS){
                //acc.log(retMaS);
                acc.acPower = retMaS[2];
                acc.acModel = retMaS[0].substr(0,2) + retMaS[0].substr(8,8);
                var power = retMaS[1].substr(2,1);
                var mode = retMaS[1].substr(3,1);
                var wind_force = retMaS[1].substr(4,1);
                var sweep = retMaS[1].substr(5,1);
                var temp = parseInt(retMaS[1].substr(6,2),16);
                acc.log.debug("[XiaoMiAcPartner][DEBUG] Partner_State:(model:%s, power_state:%s, mode:%s, wind:%s, sweep:%s, temp:%s, AC_POWER:%s",acc.acModel,power,mode,wind_force,sweep,temp,acc.acPower);

                //update values
                if (power == 1) {
                    if (mode == 0) {
                        acc.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.HEAT;
                    }else if (mode == 1) {
                        acc.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.COOL;
                    }else{
                        acc.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.AUTO;
                    }
                }else{
                    acc.LastHeatingCoolingState = acc.TargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
                }
                acc.acPartnerService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
                    .updateValue(acc.TargetHeatingCoolingState);

                if (temp <= acc.maxTemp && temp >= acc.minTemp) {
                    acc.TargetTemperature = temp;   
                }else{
                    acc.TargetTemperature = acc.maxTemp;
                }
                acc.acPartnerService.getCharacteristic(Characteristic.TargetTemperature)
                    .updateValue(acc.TargetTemperature);
                acc.log.debug("[XiaoMiAcPartner][INFO] Sync complete")
            }).catch(function(err){
                acc.log.error("[XiaoMiAcPartner][ERROR] Sync fail! Error:" + err);
            });
    }
};
