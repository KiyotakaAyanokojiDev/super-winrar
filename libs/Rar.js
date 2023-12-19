const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// RAR exits with a zero code (0) in case of successful operation.
// Non-zero exit code indicates some kind of error:

const ERROS_CODES = {
	1: 'Non fatal error(s) occurred.',
	2: 'A fatal error occurred.',
	3: 'Invalid checksum. Data is damaged.',
	4: 'Attempt to modify an archive locked by "k" command.',
	5: 'Write error.',
	6: 'File open error.',
	7: 'Wrong command line option.',
	8: 'Not enough memory.',
	9: 'File create error',
	10: 'No files matching the specified mask and options were found.',
	11: 'Wrong password.',
	12: 'Read error.',
	255: 'User stopped the process.'
};

// Intermediate RAR cli API.
const rarAPI = $args => new Promise(async resolve => {
		let $stdout = ""
		let $stderr = ""
		// we use spawn not exec cause he has no buffer limit so we can make huge operations ;)
		const child = spawn('Rar.exe', $args, {cwd: path.resolve('./libs'), windowsHide: true, windowsVerbatimArguments: true})
		// improve performance in large operations;
		child.once('spawn', () => os.setPriority(child.pid, -8));
		child.stdout.on('data', async $data => {
			$stdout += $data.toString();
		});
		child.stderr.on('data', async $data => {
			// child will ask for password so we need close manually
			if ($data.toString().includes('Enter password (will not be echoed)')) {
				child.removeAllListeners();
				resolve({$error: new Error(`RAR ERROR: MISSING PASSWORD!`), $stdout: $stdout, $stderr: $stderr});
				return process.kill(child.pid);
			};
			$stderr += $data.toString(); 
		});
		child.once('error', async $err => {
			child.removeAllListeners();
			resolve({$error: new Error(`Failed to spawn rar binary: ${$err.message}`), $stdout: $stdout, $stderr: $stderr});
		});
		child.once('exit', async $code => {
			if ($code !== 0) return resolve({$error: new Error(`RAR ERROR: ${ERROS_CODES[$code]}`), $stdout: $stdout, $stderr: $stderr});
			child.removeAllListeners();
			resolve({$error: null, $stdout: $stdout, $stderr: $stderr});
		});
});

// Cli response to array of json objects parser
const simpleFileListing = $stdout => {
	try {
		if ($stdout.includes(' Attributes      Size     Date    Time   Name')) {
			$stdout = $stdout.split('----\r\n')[1].split('\r\n-----------')[0];
			$stdout = $stdout.split('\r\n').map(cdata => {
				let modified = cdata.split('  ')[cdata.split('  ').length-2];
				let $path = cdata.split('  ')[cdata.split('  ').length-1];
				let cdataData = {
					name: ($path.includes('\\')) ? path.parse($path).base : name,
	    			path: $path,
	    			isDirectory: (cdata.includes('...D...')),
	    		    modified: new Date(`${modified.split(' ')[0]}T${modified.split(' ')[1]}:00`)
	    		};
	    		if (!cdataData.isDirectory) {
	    	    	cdataData['size'] = Number(cdata.split('  ')[cdata.split('  ').length-3]);
	    	    };
	    	    return cdataData;
			});
	    	return $stdout;
	    } else {
	    	return [];
	    };
	} catch (e) {
		return [];
	};
};

// Cli response to array of json objects parser
const advancedFileListing = $stdout => {
	try {
		if ($stdout.includes('Name: ') && $stdout.includes('Compression: ')) {
	    	$stdout = $stdout.split('Name: ').filter($childs => $childs.includes('Compression: '))
			if ($stdout.length !== 0) {
				$stdout = $stdout.map(cdata => {
					let isDir = (cdata.includes('Type: Directory'));
					let $path = cdata.split('\r')[0];
					let cdataData = {
						name: ($path.includes('\\')) ? path.parse($path).base : name,
					    path: $path,
					    isDirectory: isDir,
					    modified: new Date(`${cdata.split('Modified: ')[1].split(' ')[0]}T${cdata.split('Modified: ')[1].split(' ')[1].split(',')[0]}`),
					    compression: cdata.split('Compression: ')[1].split('\r')[0]
				    };
				    if (!isDir) {
				    	if (cdata.includes('Size: ')) {cdataData['size'] = Number(cdata.split('Size: ')[1].split('\r')[0])};
				    	if (cdata.includes('Packed size: ')) {cdataData['packedSize'] = Number(cdata.split('Packed size: ')[1].split('\r')[0])};
				    	if (cdata.includes('Ratio: ')) {cdataData['ratio'] = cdata.split('Ratio: ')[1].split('\r')[0]};
				    	if (cdata.includes('CRC32: ')) {cdataData['CRC32'] = cdata.split('CRC32: ')[1].split('\r')[0]};
				    	if (cdata.includes('CRC32 MAC:')) {cdataData['CRC32'] = cdata.split('CRC32 MAC: ')[1].split('\r')[0]};
				    };
					return cdataData;
			    });
			};
	    	return $stdout;
	    } else {
	    	return [];
	    };
	} catch (e) {
		return [];
	};
};

module.exports = { ERROS_CODES, rarAPI, simpleFileListing, advancedFileListing };